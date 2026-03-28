/**
 * Monthly Report Queue Consumer
 * Processes monthly strategic intelligence reports
 */

import type { MessageBatch, Message } from '@cloudflare/workers-types';
import { Logger } from '../../lib/logger.js';
import { ApiError, DatabaseError, ErrorCode } from '../../lib/errors.js';
import { GeminiClient, SummarizationService } from '../../services/index.js';
import { getDb, setupDb } from '../../db.js';
import { toTimestamp, fromTimestamp } from '../../db/helpers.js';
import { createEmailService } from '../../lib/email.js';
import { format, parseISO } from 'date-fns';
import { DEFAULT_MODELS } from '../../lib/constants.js';
import { renderPrompt, getPrompt, getProfileContext } from '../../lib/prompts.js';
import type { NewMonthlySummary } from '../../db/types.js';

export interface MonthlyReportMessage {
  monthStartDate: string;
  monthEndDate: string;
  force?: boolean;
  requestId: string;
  timestamp: string;
}

export async function queue(
  batch: MessageBatch<MonthlyReportMessage>,
  env: Env
): Promise<void> {
  const logger = Logger.forService('MonthlyReportConsumer');

  logger.info('Processing monthly report batch', {
    messageCount: batch.messages.length,
  });

  await setupDb(env);

  for (const message of batch.messages) {
    try {
      await processMonthlyReport(message as Message<MonthlyReportMessage>, env, logger);
      message.ack();
    } catch (error) {
      logger.error('Monthly report failed', error as Error, {
        messageId: message.body.requestId,
      });

      const shouldRetry = isRetryableError(error);
      if (!shouldRetry) {
        message.ack();
      }
    }
  }
}

async function processMonthlyReport(
  message: Message<MonthlyReportMessage>,
  env: Env,
  logger: ReturnType<typeof Logger.forService>
): Promise<void> {
  const startTime = Date.now();
  const data = message.body;

  logger.info('Processing monthly report', {
    requestId: data.requestId,
    monthStartDate: data.monthStartDate,
    monthEndDate: data.monthEndDate,
    force: data.force,
  });

  const db = getDb(env);

  const monthStart = parseISO(data.monthStartDate);
  const monthEnd = parseISO(data.monthEndDate);

  const monthStartTs = toTimestamp(monthStart)!;
  const monthEndTs = toTimestamp(monthEnd)!;

  // Check for existing report
  const existingReport = await db
    .selectFrom('MonthlySummary')
    .selectAll()
    .where('monthStartDate', '=', monthStartTs)
    .where('monthEndDate', '=', monthEndTs)
    .executeTakeFirst();

  if (existingReport && !data.force) {
    logger.info('Monthly report already exists, skipping', {
      reportId: existingReport.id,
      monthStartDate: data.monthStartDate,
      monthEndDate: data.monthEndDate,
    });
    return;
  }

  // Fetch all weekly summaries for this month
  const weeklySummaries = await db
    .selectFrom('WeeklySummary')
    .selectAll()
    .where('weekStartDate', '>=', monthStartTs)
    .where('weekEndDate', '<=', monthEndTs)
    .orderBy('weekStartDate', 'asc')
    .execute();

  if (weeklySummaries.length === 0) {
    logger.warn('No weekly summaries found for month', {
      monthStartDate: data.monthStartDate,
      monthEndDate: data.monthEndDate,
    });
    return;
  }

  logger.info('Retrieved weekly summaries for month', {
    weeklyCount: weeklySummaries.length,
    monthStartDate: data.monthStartDate,
    monthEndDate: data.monthEndDate,
  });

  // Calculate total story count from weekly summaries
  // Each weekly summary has relations to daily summaries, which have article counts
  const storyCount = await db
    .selectFrom('DailyWeeklySummaryRelation')
    .innerJoin('DailySummary', 'DailySummary.id', 'DailyWeeklySummaryRelation.dailySummaryId')
    .where(
      'DailyWeeklySummaryRelation.weeklySummaryId',
      'in',
      weeklySummaries.map((w) => w.id)
    )
    .select((eb) => eb.fn.sum<number>('DailySummary.articleCount').as('totalArticles'))
    .executeTakeFirst()
    .then((result) => result?.totalArticles || 0);

  // Build prompt context
  const templateContext = {
    monthStartDate: format(monthStart, 'MMMM yyyy'),
    monthEndDate: format(monthEnd, 'MMMM yyyy'),
    storyCount,
    weeklyCount: weeklySummaries.length,
    weeklySummaries: weeklySummaries.map((week) => {
      const weekStart = fromTimestamp(week.weekStartDate);
      const weekEnd = fromTimestamp(week.weekEndDate);
      return {
        weekStart: weekStart ? format(weekStart, 'MMM d') : 'Unknown',
        weekEnd: weekEnd ? format(weekEnd, 'MMM d, yyyy') : 'Unknown',
        title: week.title,
        content: week.recapContent,
      };
    }),
    profileContext: getProfileContext(),
  };

  // Generate monthly report
  const prompt = renderPrompt(getPrompt('monthly-report'), templateContext);

  logger.info('Generating monthly report with Gemini', {
    promptLength: prompt.length,
    weeklyCount: weeklySummaries.length,
    model: DEFAULT_MODELS.WEEKLY_SUMMARY, // Use same model as weekly for consistency
  });

  const geminiClient = new GeminiClient({
    apiKey: env.GEMINI_API_KEY,
  });

  const summarizationService = new SummarizationService({
    geminiClient,
    logger: logger.child({ component: 'SummarizationService' }),
  });

  const response = await geminiClient.generateWithRetry(prompt, {
    config: {
      model: DEFAULT_MODELS.WEEKLY_SUMMARY,
      temperature: 0.7, // Lower temp for more factual analysis
      thinkingLevel: 'HIGH',
      maxOutputTokens: 65536,
    },
    maxRetries: 3,
    onRetry: (attempt, error) => {
      logger.warn(`Retrying monthly report generation (attempt ${attempt})`, {
        error: error.message,
      });
    },
  });

  const reportContent = response.text.trim();

  logger.info('Monthly report generated', {
    contentLength: reportContent.length,
    processingTime: Date.now() - startTime,
  });

  // Parse metadata using SummarizationService
  const metadata = summarizationService.parseMonthlyReportMetadata(reportContent);

  // Parse sections using SummarizationService
  const sections = summarizationService.parseMonthlyReportSections(reportContent);

  // Save to database
  const now = Date.now();
  const savedReport = await db
    .insertInto('MonthlySummary')
    .values({
      id: crypto.randomUUID(),
      monthStartDate: monthStartTs,
      monthEndDate: monthEndTs,
      title: metadata.title,
      executiveSummary: sections.executiveSummary,
      marketAnalysis: sections.marketAnalysis,
      competitiveLandscape: sections.competitiveLandscape,
      productDevelopment: sections.productDevelopment,
      strategicImplications: sections.strategicImplications,
      topics: metadata.topics ? JSON.stringify(metadata.topics) : null,
      sentAt: null, // Will be set after email is sent
      createdAt: now,
      updatedAt: now,
    } satisfies NewMonthlySummary)
    .returningAll()
    .executeTakeFirstOrThrow();

  // Create relations to weekly summaries
  if (weeklySummaries.length > 0) {
    await db
      .insertInto('WeeklyMonthlySummaryRelation')
      .values(
        weeklySummaries.map((week) => ({
          weeklySummaryId: week.id,
          monthlySummaryId: savedReport.id,
        }))
      )
      .execute();
  }

  logger.info('Monthly report saved to database', {
    reportId: savedReport.id,
    weeklyCount: weeklySummaries.length,
  });

  // Send email to configured recipients
  const emailService = createEmailService(env.RESEND_API_KEY, env.EMAIL_FROM);

  const recipients = env.EMAIL_TO.split(',').map((email: string) => ({
    email: email.trim(),
  }));

  const emailHtml = formatMonthlyReportEmail(
    metadata.title,
    reportContent,
    data.monthStartDate,
    data.monthEndDate,
    storyCount,
    weeklySummaries.length
  );

  await emailService.sendEmail({
    to: recipients,
    subject: `${env.EMAIL_SUBJECT_PREFIX || '[Briefings]'} ${metadata.title}`,
    html: emailHtml,
  });

  // Update sentAt timestamp
  await db
    .updateTable('MonthlySummary')
    .set({ sentAt: Date.now(), updatedAt: Date.now() })
    .where('id', '=', savedReport.id)
    .execute();

  logger.info('Monthly report email sent', {
    reportId: savedReport.id,
    recipients: recipients.map((r) => r.email),
    processingTime: Date.now() - startTime,
  });
}

/**
 * Format monthly report as HTML email
 */
function formatMonthlyReportEmail(
  title: string,
  content: string,
  monthStart: string,
  monthEnd: string,
  storyCount: number,
  weeklyCount: number
): string {
  // Remove metadata lines (everything before the first ## section header)
  const lines = content.split('\n');
  const firstSectionIndex = lines.findIndex((line) => line.trim().startsWith('##'));
  let cleanContent =
    firstSectionIndex > 0
      ? lines.slice(firstSectionIndex).join('\n').trim()
      : content.trim();

  // Convert markdown to basic HTML
  cleanContent = cleanContent
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^\*\*(.+?)\*\*/gm, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/<li>/g, '<ul><li>')
    .replace(/<\/li>(?!\s*<li>)/g, '</li></ul>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #1a1a1a;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      background-color: #f9fafb;
    }
    .container {
      background-color: #ffffff;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #111827;
      font-size: 28px;
      margin-bottom: 10px;
      padding-bottom: 15px;
      border-bottom: 3px solid #2563eb;
    }
    h2 {
      color: #1f2937;
      font-size: 22px;
      margin-top: 30px;
      margin-bottom: 15px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
    }
    h3 {
      color: #374151;
      font-size: 18px;
      margin-top: 20px;
      margin-bottom: 10px;
    }
    p {
      margin-bottom: 16px;
      font-size: 15px;
    }
    ul {
      margin-bottom: 16px;
      padding-left: 24px;
    }
    li {
      margin-bottom: 8px;
    }
    .meta {
      font-size: 14px;
      color: #6b7280;
      margin-bottom: 30px;
      padding: 15px;
      background-color: #f3f4f6;
      border-radius: 6px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      font-size: 13px;
      color: #9ca3af;
      text-align: center;
    }
    strong {
      color: #111827;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${title}</h1>
    <div class="meta">
      <strong>Analysis Period:</strong> ${monthStart} to ${monthEnd}<br>
      <strong>Stories Analyzed:</strong> ${storyCount} across ${weeklyCount} weekly briefings<br>
      <strong>Report Type:</strong> Strategic Intelligence (3-5 pages)
    </div>
    <div class="content">
      <p>${cleanContent}</p>
    </div>
    <div class="footer">
      <p>Monthly Strategic Intelligence Report • Generated exclusively for internal analysis</p>
      <p>Report generated on ${format(new Date(), 'MMMM d, yyyy')}</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Determine if error should trigger a retry
 */
function isRetryableError(error: unknown): boolean {
  // Validation errors should not be retried
  if (error && typeof error === 'object' && 'name' in error && error.name === 'ValidationError') {
    return false;
  }

  // 404 Not Found - data doesn't exist, don't retry
  if (error instanceof ApiError && error.statusCode === 404) {
    return false;
  }

  // 429 Rate Limit - should retry
  if (error instanceof ApiError && error.statusCode === 429) {
    return true;
  }

  // 4xx client errors (except 429) should not be retried
  if (error instanceof ApiError) {
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return false;
    }
    return true;
  }

  // Database constraint violations should not be retried
  if (error instanceof DatabaseError) {
    if (
      error.code === ErrorCode.DUPLICATE_ENTRY ||
      error.context?.operation === 'constraint_violation'
    ) {
      return false;
    }
    return true;
  }

  // Network and timeout errors should be retried
  const retryablePatterns = [
    /timeout/i,
    /network/i,
    /connection/i,
    /ECONNRESET/i,
    /ENOTFOUND/i,
    /ETIMEDOUT/i,
    /rate limit/i,
    /quota/i,
  ];

  const errorMessage = error instanceof Error ? error.message : String(error);
  return retryablePatterns.some((pattern) => pattern.test(errorMessage));
}

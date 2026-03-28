/**
 * Health Monitor Cron
 * Runs every 6 hours to check system health
 * Sends immediate alerts when issues are detected
 * Sends status email every 48 hours (even when healthy)
 */

import { Logger } from '../../services/index.js';
import { getDb, setupDb } from '../../db.js';
import { createEmailService } from '../../lib/email.js';

interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  details?: Record<string, unknown>;
}

export async function scheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const logger = Logger.forService('HealthMonitor');

  logger.info('Health monitor cron triggered');

  // Setup database
  await setupDb(env);
  const db = getDb(env);

  const checks: HealthCheck[] = [];
  const now = Date.now();
  const fortyEightHoursAgo = now - (48 * 60 * 60 * 1000);

  try {
    // Check 1: Recent articles collected
    const recentArticlesCount = await db
      .selectFrom('Article')
      .select(({ fn }) => [fn.count<number>('id').as('count')])
      .where('createdAt', '>=', fortyEightHoursAgo)
      .executeTakeFirst();

    const articleCount = recentArticlesCount?.count ?? 0;

    if (articleCount === 0) {
      checks.push({
        name: 'Article Collection',
        status: 'fail',
        message: 'No articles collected in the last 48 hours',
        details: { articleCount, lastChecked: new Date(fortyEightHoursAgo).toISOString() },
      });
    } else if (articleCount < 10) {
      checks.push({
        name: 'Article Collection',
        status: 'warning',
        message: `Only ${articleCount} articles collected in the last 48 hours (expected >10)`,
        details: { articleCount },
      });
    } else {
      checks.push({
        name: 'Article Collection',
        status: 'pass',
        message: `${articleCount} articles collected in the last 48 hours`,
        details: { articleCount },
      });
    }

    // Check 2: Recent daily summaries generated
    const recentSummariesCount = await db
      .selectFrom('DailySummary')
      .select(({ fn }) => [fn.count<number>('id').as('count')])
      .where('createdAt', '>=', fortyEightHoursAgo)
      .executeTakeFirst();

    const summaryCount = recentSummariesCount?.count ?? 0;

    if (summaryCount === 0) {
      checks.push({
        name: 'Daily Summary Generation',
        status: 'fail',
        message: 'No daily summaries generated in the last 48 hours',
        details: { summaryCount },
      });
    } else {
      checks.push({
        name: 'Daily Summary Generation',
        status: 'pass',
        message: `${summaryCount} daily summaries generated in the last 48 hours`,
        details: { summaryCount },
      });
    }

    // Check 3: Feed validation status
    const feedStats = await db
      .selectFrom('Feed')
      .select(({ fn }) => [
        fn.count<number>('id').as('totalFeeds'),
        fn.sum<number>('isActive').as('activeFeeds'),
        fn.sum<number>('isValid').as('validFeeds'),
      ])
      .executeTakeFirst();

    const totalFeeds = feedStats?.totalFeeds ?? 0;
    const activeFeeds = feedStats?.activeFeeds ?? 0;
    const validFeeds = feedStats?.validFeeds ?? 0;
    const invalidActiveFeeds = activeFeeds - validFeeds;

    if (invalidActiveFeeds > 5) {
      checks.push({
        name: 'Feed Validation',
        status: 'fail',
        message: `${invalidActiveFeeds} active feeds are marked invalid (threshold: 5)`,
        details: { totalFeeds, activeFeeds, validFeeds, invalidActiveFeeds },
      });
    } else if (invalidActiveFeeds > 0) {
      checks.push({
        name: 'Feed Validation',
        status: 'warning',
        message: `${invalidActiveFeeds} active feeds are marked invalid`,
        details: { totalFeeds, activeFeeds, validFeeds, invalidActiveFeeds },
      });
    } else {
      checks.push({
        name: 'Feed Validation',
        status: 'pass',
        message: `All ${activeFeeds} active feeds are valid`,
        details: { totalFeeds, activeFeeds, validFeeds },
      });
    }

    // Check 4: Invalid feeds with details
    if (invalidActiveFeeds > 0) {
      const invalidFeeds = await db
        .selectFrom('Feed')
        .select(['name', 'url', 'type', 'validationError'])
        .where('isActive', '=', 1)
        .where('isValid', '=', 0)
        .execute();

      checks.push({
        name: 'Invalid Feeds List',
        status: 'warning',
        message: `${invalidFeeds.length} invalid feeds need attention`,
        details: {
          feeds: invalidFeeds.map(f => ({
            name: f.name,
            url: f.url,
            type: f.type,
            error: f.validationError,
          })),
        },
      });
    }

    // Determine overall health status
    const failedChecks = checks.filter(c => c.status === 'fail');
    const warningChecks = checks.filter(c => c.status === 'warning');
    const passedChecks = checks.filter(c => c.status === 'pass');

    logger.info('Health check results', {
      total: checks.length,
      passed: passedChecks.length,
      warnings: warningChecks.length,
      failed: failedChecks.length,
    });

    // Check when last status email was sent
    const lastStatusEmailStr = await env.BRIEFINGS_CONFIG_KV.get('last_status_email_timestamp');
    const lastStatusEmail = lastStatusEmailStr ? parseInt(lastStatusEmailStr, 10) : 0;
    const fortyEightHoursSinceLastStatus = now - lastStatusEmail;
    const shouldSendStatusEmail = fortyEightHoursSinceLastStatus >= (48 * 60 * 60 * 1000);

    // Send email if:
    // 1. There are failures or warnings (immediate alert), OR
    // 2. 48 hours have passed since last status email (regular check-in)
    if (failedChecks.length > 0 || warningChecks.length > 0) {
      await sendHealthAlertEmail(env, checks, logger, 'alert');
      await env.BRIEFINGS_CONFIG_KV.put('last_status_email_timestamp', now.toString());
    } else if (shouldSendStatusEmail) {
      await sendHealthAlertEmail(env, checks, logger, 'status');
      await env.BRIEFINGS_CONFIG_KV.put('last_status_email_timestamp', now.toString());
      logger.info('48-hour status email sent');
    } else {
      logger.info('All health checks passed - no alert needed', {
        hoursSinceLastStatus: Math.floor(fortyEightHoursSinceLastStatus / (60 * 60 * 1000)),
        nextStatusEmailIn: Math.floor(((48 * 60 * 60 * 1000) - fortyEightHoursSinceLastStatus) / (60 * 60 * 1000)),
      });
    }

  } catch (error) {
    logger.error('Health monitor failed', error as Error);

    // Send error email
    await sendHealthAlertEmail(
      env,
      [
        {
          name: 'Health Monitor Execution',
          status: 'fail',
          message: 'Health monitor failed to execute',
          details: {
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          },
        },
      ],
      logger,
      'alert'
    );

    throw error;
  }
}

/**
 * Send health alert email
 */
async function sendHealthAlertEmail(
  env: Env,
  checks: HealthCheck[],
  logger: ReturnType<typeof Logger.forService>,
  emailType: 'alert' | 'status' = 'alert'
): Promise<void> {
  const failedChecks = checks.filter(c => c.status === 'fail');
  const warningChecks = checks.filter(c => c.status === 'warning');
  const passedChecks = checks.filter(c => c.status === 'pass');

  const subject = emailType === 'status'
    ? '✅ Briefings System Status - All Systems Operational'
    : failedChecks.length > 0
    ? '🚨 Briefings Health Alert - Issues Detected'
    : '⚠️ Briefings Health Warning - Potential Issues';

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${failedChecks.length > 0 ? '#dc2626' : '#f59e0b'}; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
    .check { margin: 15px 0; padding: 15px; border-radius: 6px; border-left: 4px solid; }
    .check-fail { background: #fee; border-color: #dc2626; }
    .check-warning { background: #fef3c7; border-color: #f59e0b; }
    .check-pass { background: #d1fae5; border-color: #10b981; }
    .check-name { font-weight: bold; margin-bottom: 5px; }
    .details { font-size: 0.9em; color: #666; margin-top: 10px; font-family: monospace; }
    .summary { background: white; padding: 15px; border-radius: 6px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${failedChecks.length > 0 ? '🚨' : '⚠️'} Briefings System Health Alert</h1>
      <p style="margin: 0; opacity: 0.9;">${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</p>
    </div>
    <div class="content">
      <div class="summary">
        <h2>Summary</h2>
        <p>
          <strong>${failedChecks.length}</strong> critical issues detected<br>
          <strong>${warningChecks.length}</strong> warnings<br>
          <strong>${passedChecks.length}</strong> checks passed
        </p>
      </div>

      ${failedChecks.length > 0 ? `
        <h2>❌ Critical Issues</h2>
        ${failedChecks.map(check => `
          <div class="check check-fail">
            <div class="check-name">${check.name}</div>
            <div>${check.message}</div>
            ${check.details ? `<div class="details">${JSON.stringify(check.details, null, 2)}</div>` : ''}
          </div>
        `).join('')}
      ` : ''}

      ${warningChecks.length > 0 ? `
        <h2>⚠️ Warnings</h2>
        ${warningChecks.map(check => `
          <div class="check check-warning">
            <div class="check-name">${check.name}</div>
            <div>${check.message}</div>
            ${check.details ? `<div class="details">${JSON.stringify(check.details, null, 2)}</div>` : ''}
          </div>
        `).join('')}
      ` : ''}

      ${passedChecks.length > 0 ? `
        <h2>✅ Passed Checks</h2>
        ${passedChecks.map(check => `
          <div class="check check-pass">
            <div class="check-name">${check.name}</div>
            <div>${check.message}</div>
          </div>
        `).join('')}
      ` : ''}

      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 0.9em; color: #666;">
        <p><strong>Next Steps:</strong></p>
        <ul>
          <li>Check the production logs: <code>pnpm tail</code></li>
          <li>Review feed status: Query the Feed table in D1</li>
          <li>Manually trigger feed fetch if needed: <code>pnpm trigger feed-fetch</code></li>
          <li>Check the dashboard at: <code>wrangler pages deployment list</code></li>
        </ul>
      </div>
    </div>
  </div>
</body>
</html>
  `;

  try {
    const emailService = createEmailService(env.RESEND_API_KEY, env.EMAIL_FROM);

    // Send health alerts only to the primary admin (not to audience members)
    const recipients = [{ email: 'mikedteaches@gmail.com' }];

    await emailService.sendEmail({
      to: recipients,
      subject,
      html: htmlBody,
    });

    logger.info('Health alert email sent', {
      failedCount: failedChecks.length,
      warningCount: warningChecks.length,
    });
  } catch (error) {
    logger.error('Failed to send health alert email', error as Error);
    throw error;
  }
}

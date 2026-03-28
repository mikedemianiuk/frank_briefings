/**
 * Monthly Report Cron
 * Triggers on the 1st of each month at 9 AM UTC
 * Queues monthly strategic report generation
 */

import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types';
import { Logger } from '../../lib/logger.js';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
import { getDb } from '../../db.js';
import { toTimestamp } from '../../db/helpers.js';

export async function scheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const logger = Logger.forService('MonthlyReportCron');

  logger.info('Monthly report cron triggered', {
    cron: event.cron,
    scheduledTime: new Date(event.scheduledTime).toISOString(),
  });

  try {
    const db = getDb(env);

    // Calculate previous month's date range
    // If today is March 1, we want to report on February
    const today = new Date(event.scheduledTime);
    const previousMonthEnd = endOfMonth(subMonths(today, 1));
    const previousMonthStart = startOfMonth(subMonths(today, 1));

    const monthStartDate = format(previousMonthStart, 'yyyy-MM-dd');
    const monthEndDate = format(previousMonthEnd, 'yyyy-MM-dd');

    logger.info('Monthly report date range calculated', {
      monthStartDate,
      monthEndDate,
      startTs: previousMonthStart.getTime(),
      endTs: previousMonthEnd.getTime(),
    });

    // Check if monthly report already exists
    const monthStartTs = toTimestamp(previousMonthStart)!;
    const monthEndTs = toTimestamp(previousMonthEnd)!;

    const existingReport = await db
      .selectFrom('MonthlySummary')
      .selectAll()
      .where('monthStartDate', '=', monthStartTs)
      .where('monthEndDate', '=', monthEndTs)
      .executeTakeFirst();

    if (existingReport) {
      logger.info('Monthly report already exists, skipping', {
        reportId: existingReport.id,
        monthStartDate,
        monthEndDate,
        sentAt: existingReport.sentAt,
      });
      return;
    }

    // Queue monthly report generation
    const requestId = crypto.randomUUID();

    await env.MONTHLY_REPORT_QUEUE.send({
      monthStartDate,
      monthEndDate,
      force: false,
      requestId,
      timestamp: new Date().toISOString(),
    });

    logger.info('Monthly report queued successfully', {
      requestId,
      monthStartDate,
      monthEndDate,
      queueName: 'briefings-monthly-report',
    });

  } catch (error) {
    logger.error('Failed to initiate monthly report', error as Error, {
      cron: event.cron,
      scheduledTime: new Date(event.scheduledTime).toISOString(),
    });
    throw error;
  }
}

import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types';
import { Logger } from '../../lib/logger.js';
import { QueueDispatcher } from '../utils/queue-dispatcher.js';
import { getDb, setupDb } from '../../db.js';

// Feeds with known access restrictions (403/405) that should be skipped during validation
// These feeds will only be validated when they successfully fetch articles
const FEEDS_WITH_ACCESS_RESTRICTIONS = [
  'https://news.ycombinator.com/news', // Hacker News - returns 405
  'https://www.mastercard.com/news/press/', // Mastercard - returns 403
  'https://ir.united.com/news-releases', // United Airlines - returns 403
];

/**
 * Cron handler for validating all active feeds
 */
export async function scheduled(
  event: ScheduledEvent,
  env: Env,
  ctx?: ExecutionContext
): Promise<void> {
  const logger = Logger.forService('FeedValidationCron');
  const startTime = Date.now();

  logger.info('Feed validation cron triggered', {
    scheduledTime: new Date(event.scheduledTime).toISOString(),
    cron: event.cron,
  });

  try {
    await setupDb(env);
    const db = getDb(env);

    const activeFeeds = await db
      .selectFrom('Feed')
      .selectAll()
      .where('isActive', '=', 1)
      .execute();

    if (activeFeeds.length === 0) {
      logger.warn('No active feeds found for validation');
      return;
    }

    // Filter out feeds with known access restrictions
    const feedsToValidate = activeFeeds.filter(feed => !FEEDS_WITH_ACCESS_RESTRICTIONS.includes(feed.url));
    const skippedFeeds = activeFeeds.filter(feed => FEEDS_WITH_ACCESS_RESTRICTIONS.includes(feed.url));

    if (skippedFeeds.length > 0) {
      logger.info('Skipping feeds with known access restrictions', {
        count: skippedFeeds.length,
        feeds: skippedFeeds.map(f => ({ name: f.name, url: f.url })),
      });
    }

    logger.info('Found active feeds for validation', {
      total: activeFeeds.length,
      toValidate: feedsToValidate.length,
      skipped: skippedFeeds.length,
      valid: feedsToValidate.filter((f) => f.isValid === 1).length,
      invalid: feedsToValidate.filter((f) => f.isValid !== 1).length,
    });

    const queueDispatcher = QueueDispatcher.create(env);

    const results = {
      total: activeFeeds.length,
      queued: 0,
      failed: 0,
      skipped: skippedFeeds.length,
    };

    const validationPromises = feedsToValidate.map(async (feed) => {
      try {
        await queueDispatcher.sendFeedFetchMessage({
          feedUrl: feed.url,
          feedName: feed.name,
          feedId: feed.id,
          action: 'validate',
        });
        results.queued++;
      } catch (error) {
        logger.error('Failed to queue feed validation', error as Error, {
          feedId: feed.id,
          feedName: feed.name,
          feedUrl: feed.url,
        });
        results.failed++;
      }
    });

    await Promise.all(validationPromises);

    const duration = Date.now() - startTime;

    logger.info('Feed validation cron completed', {
      duration,
      results,
      feedsPerSecond: results.total / (duration / 1000),
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Feed validation cron failed', error as Error, {
      duration,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    });

    throw error;
  }
}

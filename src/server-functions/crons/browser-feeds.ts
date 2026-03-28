// Env type is globally defined
import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types';
import { Logger, FeedService } from '../../services/index.js';
import { QueueDispatcher } from '../utils/queue-dispatcher.js';

/**
 * Cron handler for browser-rendered feed fetches
 * Scheduled via wrangler.toml: 0 9 * * 5 (Fridays at 9 AM UTC)
 *
 * Cost Optimization:
 * - Browser rendering requires Workers Paid plan ($5/month)
 * - Charges based on CPU time, not wall time
 * - Running weekly instead of every 4h saves ~95% of browser costs
 * - Recommended: Keep browser feeds separate from regular RSS/scrape feeds
 *
 * Responsibilities:
 * 1. Load active browser-type feeds only
 * 2. Queue feed fetch task for each browser feed
 * 3. Track execution metrics
 */
export async function scheduled(
  event: ScheduledEvent,
  env: Env,
  ctx?: ExecutionContext
): Promise<void> {
  const logger = Logger.forService('BrowserFeedsCron');
  const startTime = Date.now();

  logger.info('Browser feeds cron triggered', {
    scheduledTime: new Date(event.scheduledTime).toISOString(),
    cron: event.cron,
  });

  try {
    // Initialize services
    const feedService = new FeedService({
      logger: logger.child({ component: 'FeedService' }),
    });

    // Load active feeds
    const allFeeds = await feedService.getActiveFeeds(env);

    // Filter for browser-type feeds only
    const browserFeeds = allFeeds.filter((feed) => feed.type === 'browser');

    if (browserFeeds.length === 0) {
      logger.warn('No active browser feeds found');
      return;
    }

    logger.info('Found browser feeds', {
      total: browserFeeds.length,
      feeds: browserFeeds.map((f) => f.name),
    });

    // Initialize queue dispatcher
    const queueDispatcher = QueueDispatcher.create(env);

    // Track results
    const results = {
      total: 0,
      queued: 0,
      failed: 0,
      skipped: 0,
    };

    // Queue browser feed fetch tasks
    for (const feed of browserFeeds) {
      results.total++;

      if (!feed.isActive) {
        logger.debug('Skipping inactive feed', { feedName: feed.name });
        results.skipped++;
        continue;
      }

      try {
        const requestId = await queueDispatcher.sendToFeedFetchQueue(feed.url, feed.name);

        logger.debug('Browser feed fetch task queued', {
          feedName: feed.name,
          feedUrl: feed.url,
          feedType: feed.type,
          requestId,
        });

        results.queued++;
      } catch (error) {
        logger.error('Failed to queue browser feed fetch task', error as Error, {
          feedName: feed.name,
          feedUrl: feed.url,
        });

        results.failed++;
      }
    }

    const duration = Date.now() - startTime;

    logger.info('Browser feeds cron completed', {
      duration,
      results,
      costNote: 'Browser rendering: ~$0.02 per session, CPU time only',
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Browser feeds cron failed', error as Error, {
      duration,
      scheduledTime: new Date(event.scheduledTime).toISOString(),
    });

    // Re-throw to signal cron failure
    throw error;
  }
}

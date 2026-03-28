import { Logger } from '../../services/index.js';
import {
  createSuccessResponse,
  createErrorResponse,
} from './schemas.js';
import { scheduled as healthMonitorCron } from '../crons/health-monitor.js';

/**
 * Manually trigger health monitor
 * POST /run/health-monitor
 */
export async function POST(request: Request, env: Env): Promise<Response> {
  const logger = Logger.forService('HealthMonitorEndpoint');

  try {
    logger.info('Manual health monitor trigger received');

    // Create a mock scheduled event
    const mockEvent = {
      cron: '0 */6 * * *',
      scheduledTime: Date.now(),
      type: 'scheduled' as const,
    } as ScheduledEvent;

    // Create execution context
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => promise,
      passThroughOnException: () => {},
    } as ExecutionContext;

    // Execute health monitor
    await healthMonitorCron(mockEvent, env, ctx);

    logger.info('Health monitor completed successfully');

    return createSuccessResponse({
      message: 'Health monitor executed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Health monitor execution failed', error as Error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Health monitor failed',
      500
    );
  }
}

/**
 * Get health monitor status
 * GET /run/health-monitor
 */
export async function GET(request: Request, env: Env): Promise<Response> {
  const logger = Logger.forService('HealthMonitorEndpoint');

  try {
    // Get last status email timestamp
    const lastStatusEmailStr = await env.BRIEFINGS_CONFIG_KV.get('last_status_email_timestamp');
    const lastStatusEmail = lastStatusEmailStr ? parseInt(lastStatusEmailStr, 10) : null;

    return createSuccessResponse({
      message: 'Health monitor status',
      lastStatusEmail: lastStatusEmail
        ? new Date(lastStatusEmail).toISOString()
        : null,
      hoursSinceLastStatus: lastStatusEmail
        ? Math.floor((Date.now() - lastStatusEmail) / (60 * 60 * 1000))
        : null,
      nextScheduledRun: 'Every 6 hours (cron: 0 */6 * * *)',
    });
  } catch (error) {
    logger.error('Failed to get health monitor status', error as Error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to get status',
      500
    );
  }
}

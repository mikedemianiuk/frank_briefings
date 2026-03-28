// Env type is globally defined
import { Logger } from '../../services/index.js';
import { QueueDispatcher } from '../utils/queue-dispatcher.js';
import {
  parseRequestBody,
  createSuccessResponse,
  createErrorResponse,
  createValidationErrorResponse,
  MonthlyReportRequestSchema,
  ValidationError,
  calculateMonthRange,
} from './schemas.js';

/**
 * Initiate monthly report generation task
 * POST /run/monthly-report
 *
 * Body (JSON):
 * - monthStartDate (optional): Start date of month (YYYY-MM-DD format). Must be provided with monthEndDate.
 * - monthEndDate (optional): End date of month (YYYY-MM-DD format). Must be provided with monthStartDate.
 * - force (optional): Force regeneration even if report already exists
 *
 * If no dates provided, defaults to previous month
 */
export async function POST(request: Request, env: Env): Promise<Response> {
  const logger = Logger.forService('MonthlyReportEndpoint');

  try {
    logger.info('Monthly report request received');

    // Parse and validate request body
    const body = await parseRequestBody(request, MonthlyReportRequestSchema);

    // Calculate month range (defaults to previous month if not specified)
    const { monthStartDate, monthEndDate } = calculateMonthRange(body.monthStartDate, body.monthEndDate);

    // Validate dates are not in the future
    const today = new Date().toISOString().split('T')[0];
    if (monthStartDate > today || monthEndDate > today) {
      logger.warn('Monthly report requested for future dates', { monthStartDate, monthEndDate });
      return createErrorResponse('Cannot generate report for future dates', 400, 'INVALID_DATE', {
        monthStartDate,
        monthEndDate,
        today,
      });
    }

    // Validate month span (should be reasonable, e.g., 20-45 days)
    const startDate = new Date(monthStartDate);
    const endDate = new Date(monthEndDate);
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff < 20 || daysDiff > 45) {
      logger.warn('Invalid month span requested', { monthStartDate, monthEndDate, daysDiff });
      return createErrorResponse(
        'Month span must be between 20 and 45 days',
        400,
        'INVALID_MONTH_SPAN',
        { monthStartDate, monthEndDate, daysDiff }
      );
    }

    // Initialize queue dispatcher
    const queueDispatcher = QueueDispatcher.create(env);

    // Send monthly report task to queue
    const requestId = await queueDispatcher.sendToMonthlyReportQueue(
      monthStartDate,
      monthEndDate,
      body.force
    );

    const message = `Monthly report task initiated for ${monthStartDate} to ${monthEndDate}`;

    logger.info('Monthly report task initiated', {
      monthStartDate,
      monthEndDate,
      daysDiff,
      requestId,
      force: body.force,
    });

    return createSuccessResponse(message, {
      requestId,
      monthStartDate,
      monthEndDate,
      daysDiff,
      force: body.force,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      logger.warn('Monthly report request validation failed', {
        error: error.message,
        errors: error.errors,
      });
      return createValidationErrorResponse(error);
    }

    logger.error('Monthly report request failed', error as Error);

    return createErrorResponse('Internal server error', 500, 'INTERNAL_ERROR', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * GET method for checking status or getting information
 */
export async function GET(
  request: Request,
  env: Env,
  ctx?: { authenticated?: boolean }
): Promise<Response> {
  const logger = Logger.forService('MonthlyReportEndpoint');

  // Check if authenticated (set by checkApiKey middleware)
  const authenticated = ctx?.authenticated || false;

  if (!authenticated) {
    return createErrorResponse(
      'Authentication required. Please provide X-API-Key header.',
      401,
      'AUTHENTICATION_REQUIRED'
    );
  }

  try {
    const url = new URL(request.url);
    const monthStartDate = url.searchParams.get('monthStartDate');
    const monthEndDate = url.searchParams.get('monthEndDate');

    // Parse query parameters using the same schema
    const params = {
      monthStartDate: monthStartDate || undefined,
      monthEndDate: monthEndDate || undefined,
    };

    const validatedParams = MonthlyReportRequestSchema.parse(params);

    // Calculate month range (defaults to previous month if not specified)
    const monthRange = calculateMonthRange(
      validatedParams.monthStartDate,
      validatedParams.monthEndDate
    );

    // Calculate additional information
    const startDate = new Date(monthRange.monthStartDate);
    const endDate = new Date(monthRange.monthEndDate);
    const daysDiff =
      Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Return API documentation with examples
    return new Response(
      JSON.stringify(
        {
          endpoint: '/api/run/monthly-report',
          method: 'POST',
          description: 'Trigger monthly report generation',
          headers: {
            'X-API-Key': 'Required - Your API key',
            'Content-Type': 'application/json (for POST body)',
          },
          body: {
            monthStartDate:
              '(optional) Start date in YYYY-MM-DD format. Defaults to first day of previous month.',
            monthEndDate: '(optional) End date in YYYY-MM-DD format. Defaults to last day of previous month.',
            force: '(optional) Force regeneration even if report exists',
          },
          workflow: [
            'Initiator: Validate dates and trigger aggregation',
            'Aggregator: Collect weekly summaries and prepare data',
            'Generator: Create monthly content using AI',
            'Postprocessor: Extract insights and generate title',
            'Finalizer: Assemble final report and trigger publishing',
          ],
          examples: {
            generate_last_month: {
              method: 'POST',
              headers: { 'X-API-Key': 'your-api-key' },
              body: {},
            },
            generate_specific_month: {
              method: 'POST',
              headers: { 'X-API-Key': 'your-api-key' },
              body: {
                monthStartDate: '2024-12-01',
                monthEndDate: '2024-12-31',
              },
            },
          },
          currentRequest: {
            parsedMonthStartDate: monthRange.monthStartDate,
            parsedMonthEndDate: monthRange.monthEndDate,
            daysDiff,
          },
        },
        null,
        2
      ),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      logger.warn('Monthly report status check validation failed', {
        error: error.message,
        errors: error.errors,
      });
      return createValidationErrorResponse(error);
    }

    logger.error('Monthly report status check failed', error as Error);

    return createErrorResponse('Internal server error', 500, 'INTERNAL_ERROR', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

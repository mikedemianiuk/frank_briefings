# Briefings System Improvement Plan

**Date:** February 22, 2026
**Status:** Action Required
**Priority:** High

---

## Executive Summary

Three critical improvements needed for the Briefings system:

1. **Fix validation cron** - Currently breaking all feeds every few weeks
2. **Add 48-hour monitoring** - Catch issues before they cause missed briefings
3. **Restructure email format** - Organized by themes with enhanced summaries

---

## Issue #1: Fix Validate-Feeds Cron Logic

### Root Cause Analysis

**The Bug:**
The validate-feeds cron (`0 6 * * *` - 1 AM ET daily) uses `validateRssFeed()` for ALL feeds, regardless of type:

```typescript
// Current code (BROKEN):
const validationResult = await validateRssFeed(message.feedUrl);
// This marks ALL scrape-type feeds as invalid!
```

**Your Feed Breakdown:**
- Total: 48 feeds
- Type "scrape": ~45 feeds (web scraping with CSS selectors)
- Type "rss": ~3 feeds (actual RSS/Atom feeds)

**What Happens:**
1. Validate-feeds cron runs daily at 1 AM ET
2. Calls `validateRssFeed()` on all 48 feeds
3. RSS validator correctly returns `isValid: false` for HTML pages
4. All 45 scrape feeds marked invalid (`isValid = 0`)
5. Feed fetch sees 0 valid feeds → stops collecting
6. System fails silently

**Why This Wasn't Caught:**
- Validate-feeds cron was added after most feeds were scrape-type
- No alerts when all feeds become invalid
- System degrades silently over time

###The Fix

**File:** [`src/server-functions/queues/feed-fetch-consumer.ts:221-289`](../src/server-functions/queues/feed-fetch-consumer.ts#L221-L289)

**Change:**
Replace the `validateFeed()` function to handle both RSS and scrape feeds:

```typescript
async function validateFeed(
  message: FeedFetchMessage,
  env: Env,
  logger: ReturnType<typeof Logger.forService>
): Promise<void> {
  const startTime = Date.now();
  const db = getDb(env);

  try {
    logger.info('Validating feed', {
      feedUrl: message.feedUrl,
      feedName: message.feedName,
    });

    // ✅ NEW: Get feed from database to check type
    const feed = await db
      .selectFrom('Feed')
      .selectAll()
      .where('url', '=', message.feedUrl)
      .executeTakeFirst();

    if (!feed) {
      throw new Error(`Feed not found: ${message.feedUrl}`);
    }

    let validationResult: {
      isValid: boolean;
      error?: string;
      title?: string;
    };

    // ✅ NEW: Validate based on feed type
    if (feed.type === 'rss') {
      // For RSS feeds, use the RSS validator
      validationResult = await validateRssFeed(message.feedUrl);
    } else if (feed.type === 'scrape') {
      // ✅ NEW: For scrape feeds, just check if URL is accessible
      // Don't mark as invalid if it returns HTML (that's expected!)
      try {
        const response = await fetch(message.feedUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; FeedValidator/1.0)',
          },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          validationResult = {
            isValid: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
          };
        } else {
          // ✅ URL is accessible - mark as valid
          // Actual content validation happens during feed fetch
          validationResult = {
            isValid: true,
          };
        }
      } catch (error) {
        validationResult = {
          isValid: false,
          error: error instanceof Error ? error.message : 'Failed to fetch URL',
        };
      }
    } else {
      // Unknown feed type - skip validation
      logger.warn('Unknown feed type, skipping validation', {
        feedType: feed.type,
        feedUrl: message.feedUrl,
      });
      return;
    }

    const updates: Record<string, unknown> = {
      isValid: validationResult.isValid ? 1 : 0,
      validationError: validationResult.isValid ? null : validationResult.error,
      updatedAt: Date.now(),
    };

    if (validationResult.isValid && validationResult.title) {
      updates.name = validationResult.title;
    }

    await db
      .updateTable('Feed')
      .set(updates)
      .where('url', '=', message.feedUrl)
      .execute();

    const duration = Date.now() - startTime;

    logger.info('Feed validation completed', {
      feedUrl: message.feedUrl,
      feedType: feed.type,  // ✅ NEW: Log feed type
      isValid: validationResult.isValid,
      error: validationResult.error,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Feed validation failed', {
      feedUrl: message.feedUrl,
      error: error instanceof Error ? error.message : String(error),
      duration,
    });

    try {
      await db
        .updateTable('Feed')
        .set({
          isValid: 0,
          validationError: error instanceof Error ? error.message : 'Validation failed',
          updatedAt: Date.now(),
        })
        .where('url', '=', message.feedUrl)
        .execute();
    } catch (updateError) {
      logger.error('Failed to update feed validation status', {
        feedUrl: message.feedUrl,
        error: updateError instanceof Error ? updateError.message : String(updateError),
      });
    }

    throw error;
  }
}
```

**Testing:**
```bash
# 1. Apply the fix above
# 2. Deploy
pnpm deploy

# 3. Reset all feeds to valid
npx wrangler d1 execute DB --remote --command \
  "UPDATE Feed SET isValid = 1 WHERE isActive = 1"

# 4. Manually trigger validation cron (simulates tomorrow 1 AM)
# (This would need a new trigger endpoint - or wait for cron to run)

# 5. Verify scrape feeds stay valid
npx wrangler d1 execute DB --remote --command \
  "SELECT type, COUNT(*) as count,
   SUM(CASE WHEN isValid = 1 THEN 1 ELSE 0 END) as valid
   FROM Feed WHERE isActive = 1 GROUP BY type"

# Expected: scrape feeds should have valid = count (all valid)
```

---

## Issue #2: Add 48-Hour Monitoring

### Goal
Detect system failures within 48 hours, not 12 days.

### Monitoring Checklist

**Critical Metrics to Track:**
1. Last successful article collection
2. Last successful daily summary
3. Last successful weekly digest
4. Number of valid feeds (should never drop to 0)

### Implementation Options

#### Option A: External Monitoring Service (Recommended)

**Use:** UptimeRobot, Pingdom, or BetterUptime

**Endpoint to Create:**
[`src/server-functions/http/health-check.ts`](../src/server-functions/http/health-check.ts) (new file)

```typescript
/**
 * Enhanced health check endpoint for external monitoring
 * GET /api/health-check
 */

import { getDb } from '../../db';
import { Logger } from '../../lib/logger';

export async function GET(req: Request, env: Env): Promise<Response> {
  const logger = Logger.forService('HealthCheck');

  try {
    const db = getDb(env);
    const now = Date.now();
    const fortyEightHoursAgo = now - (48 * 60 * 60 * 1000);

    // Check 1: Recent article collection
    const recentArticle = await db
      .selectFrom('Article')
      .select('createdAt')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .executeTakeFirst();

    const articleAge = recentArticle ? now - recentArticle.createdAt : Infinity;
    const articleHealthy = articleAge < fortyEightHoursAgo;

    // Check 2: Recent daily summary
    const recentSummary = await db
      .selectFrom('DailySummary')
      .select('createdAt')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .executeTakeFirst();

    const summaryAge = recentSummary ? now - recentSummary.createdAt : Infinity;
    const summaryHealthy = summaryAge < fortyEightHoursAgo;

    // Check 3: Valid feeds count
    const feedStats = await db
      .selectFrom('Feed')
      .select((eb) => [
        eb.fn.count('id').as('total'),
        eb.fn.sum(
          eb.case().when('isActive', '=', 1).then(1).else(0).end()
        ).as('active'),
        eb.fn.sum(
          eb.case()
            .when('isActive', '=', 1)
            .when('isValid', '=', 1)
            .then(1)
            .else(0)
            .end()
        ).as('valid'),
      ])
      .executeTakeFirst();

    const feedsHealthy = (feedStats?.valid ?? 0) > 0;

    // Overall health
    const isHealthy = articleHealthy && summaryHealthy && feedsHealthy;

    const status = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks: {
        articles: {
          status: articleHealthy ? 'pass' : 'fail',
          lastCollected: recentArticle ? new Date(recentArticle.createdAt).toISOString() : null,
          ageHours: recentArticle ? Math.floor(articleAge / (60 * 60 * 1000)) : null,
        },
        dailySummaries: {
          status: summaryHealthy ? 'pass' : 'fail',
          lastGenerated: recentSummary ? new Date(recentSummary.createdAt).toISOString() : null,
          ageHours: recentSummary ? Math.floor(summaryAge / (60 * 60 * 1000)) : null,
        },
        feeds: {
          status: feedsHealthy ? 'pass' : 'fail',
          total: feedStats?.total ?? 0,
          active: feedStats?.active ?? 0,
          valid: feedStats?.valid ?? 0,
        },
      },
    };

    // Return 200 if healthy, 503 if unhealthy
    return Response.json(status, {
      status: isHealthy ? 200 : 503,
    });
  } catch (error) {
    logger.error('Health check failed', error as Error);
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
```

**Add Route:**
Update [`src/index.ts`](../src/index.ts) to include:

```typescript
// Add to API routes
api.get('/health-check', async (c) => {
  const response = await healthCheckGET(c.req.raw, c.env);
  return response;
});
```

**Setup External Monitor:**

1. **Create account** on UptimeRobot (free tier)
2. **Add HTTP monitor:**
   - URL: `https://briefings.mikes-briefings.workers.dev/api/health-check`
   - Interval: Every 12 hours (2x per day)
   - Alert when: Status code ≠ 200

3. **Configure alerts:**
   - Email: mikedteaches@gmail.com
   - SMS: (optional, for critical alerts)

4. **Alert message:**
   ```
   Briefings system unhealthy!

   Check: https://briefings.mikes-briefings.workers.dev/api/health-check

   Possible issues:
   - No articles collected in 48h
   - No daily summaries in 48h
   - All feeds marked invalid
   ```

#### Option B: Cloudflare Cron Alert (Alternative)

**Create:** [`src/server-functions/crons/health-monitor.ts`](../src/server-functions/crons/health-monitor.ts) (new file)

```typescript
/**
 * Health monitoring cron
 * Runs every 12 hours and sends alerts if system is unhealthy
 */

import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types';
import { Logger } from '../../lib/logger';
import { getDb } from '../../db';
import { createEmailService } from '../../lib/email';

export async function scheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const logger = Logger.forService('HealthMonitor');

  logger.info('Health monitor cron triggered');

  try {
    const db = getDb(env);
    const now = Date.now();
    const fortyEightHoursAgo = now - (48 * 60 * 60 * 1000);

    const issues: string[] = [];

    // Check articles
    const recentArticle = await db
      .selectFrom('Article')
      .select('createdAt')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!recentArticle || recentArticle.createdAt < fortyEightHoursAgo) {
      const hoursAgo = recentArticle
        ? Math.floor((now - recentArticle.createdAt) / (60 * 60 * 1000))
        : 9999;
      issues.push(`⚠️ No articles collected in ${hoursAgo} hours`);
    }

    // Check daily summaries
    const recentSummary = await db
      .selectFrom('DailySummary')
      .select('createdAt')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!recentSummary || recentSummary.createdAt < fortyEightHoursAgo) {
      const hoursAgo = recentSummary
        ? Math.floor((now - recentSummary.createdAt) / (60 * 60 * 1000))
        : 9999;
      issues.push(`⚠️ No daily summaries generated in ${hoursAgo} hours`);
    }

    // Check valid feeds
    const feedStats = await db
      .selectFrom('Feed')
      .select((eb) => [
        eb.fn.count('id').as('total'),
        eb.fn.sum(
          eb.case()
            .when('isActive', '=', 1)
            .when('isValid', '=', 1)
            .then(1)
            .else(0)
            .end()
        ).as('valid'),
      ])
      .executeTakeFirst();

    if ((feedStats?.valid ?? 0) === 0) {
      issues.push(`🚨 CRITICAL: All feeds marked invalid (0 valid)`);
    }

    // If issues found, send alert email
    if (issues.length > 0 && env.RESEND_API_KEY) {
      const emailService = createEmailService(env.RESEND_API_KEY, env.EMAIL_FROM);

      await emailService.sendEmail({
        to: [{ email: 'mikedteaches@gmail.com' }],
        subject: '🚨 Briefings System Alert - Action Required',
        html: `
          <h1>Briefings System Health Alert</h1>
          <p><strong>${issues.length} issue(s) detected:</strong></p>
          <ul>
            ${issues.map(issue => `<li>${issue}</li>`).join('')}
          </ul>
          <h2>Quick Fixes</h2>
          <pre>
# Reset feeds to valid
npx wrangler d1 execute DB --remote --command \\
  "UPDATE Feed SET isValid = 1 WHERE isActive = 1"

# Trigger feed fetch
pnpm trigger feed-fetch

# Trigger daily summary
pnpm trigger daily-summary $(date +%Y-%m-%d)
          </pre>
          <p><small>Monitored at: ${new Date().toISOString()}</small></p>
        `,
      });

      logger.warn('Health alert sent', { issueCount: issues.length, issues });
    } else {
      logger.info('System healthy', { issuesFound: 0 });
    }
  } catch (error) {
    logger.error('Health monitor failed', error as Error);
    throw error;
  }
}
```

**Add Cron:**
Update [`wrangler.toml`](../wrangler.toml):

```toml
crons = [
  "0 */4 * * *",    # Feed fetch
  "0 10 * * *",     # Daily summary
  "0 6 * * *",      # Validate feeds
  "0 13 * * 7",     # Weekly digest
  "0 */12 * * *"    # ✅ NEW: Health monitor (every 12 hours)
]
```

**Add Handler:**
Update [`src/index.ts`](../src/index.ts):

```typescript
import { scheduled as healthMonitorCron } from './server-functions/crons/health-monitor';

const cronHandlers: Record<string, typeof feedFetchCron> = {
  '0 */4 * * *': feedFetchCron,
  '0 10 * * *': dailySummaryCron,
  '0 6 * * *': validateFeedsCron,
  '0 13 * * 7': weeklyDigestCron,
  '0 */12 * * *': healthMonitorCron,  // ✅ NEW
};
```

---

## Issue #3: Restructure Weekly Email Format

### Current Format

The weekly digest currently has:
- Title (AI-generated emoji + theme)
- Recap content (mixed topics)
- Below the fold content (less important items)
- So what section (key takeaways)

### New Format (Requested)

```
Mike's Briefings [Title]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WEEKLY THESIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[250-500 word synthesized analysis of the week's themes,
trends, and strategic implications. Written in executive
summary style with clear takeaways.]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

THEME HIGHLIGHTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. FINTECH VENTURE CAPITAL
   • [Story 1 headline] - [1-2 sentence summary]
   • [Story 2 headline] - [1-2 sentence summary]

2. AIRLINES/HOTELS/ECOMMERCE LOYALTY
   • [Story 1 headline] - [1-2 sentence summary]
   • [Story 2 headline] - [1-2 sentence summary]

3. FINANCIAL INSTITUTIONS (JPMC, AMEX, CITI, CAPITAL ONE)
   • [Story 1 headline] - [1-2 sentence summary]
   • [Story 2 headline] - [1-2 sentence summary]

4. PAYMENTS INDUSTRY NEWS
   • [Story 1 headline] - [1-2 sentence summary]
   • [Story 2 headline] - [1-2 sentence summary]

5. STARTUPS (CHIME, STRIPE, MERCURY, SOFI, CARDLESS, BILT)
   • [Story 1 headline] - [1-2 sentence summary]
   • [Story 2 headline] - [1-2 sentence summary]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This briefing synthesized [N] stories from [M] sources
from [start date] to [end date].
```

### Implementation

**File:** [`src/services/summarization/summarization-service.ts`](../src/services/summarization/summarization-service.ts)

**Changes Needed:**

1. **Update Prompt Template**
   - Add weekly thesis requirement (250-500 words)
   - Add theme-based categorization
   - Map feed sources to themes

2. **Feed-to-Theme Mapping**

   Create new file: [`src/lib/theme-mapping.ts`](../src/lib/theme-mapping.ts)

   ```typescript
   export const THEME_MAPPING = {
     'Fintech Venture Capital': [
       'a16z Articles',
       'Sequoia Capital Stories',
       'First Round Review',
       'Index Ventures Perspectives',
       'Lightspeed Venture Partners',
       'Union Square Ventures',
       'Greylock (Greymatter)',
       'Accel Noteworthy',
       'Bessemer Venture Partners',
       'Kleiner Perkins Perspectives',
       'Canapi Ventures Insights',
     ],
     'Airlines/Hotels/eCommerce Loyalty': [
       'United Airlines IR',
       'Southwest Airlines News',
       'Delta Air Lines News',
       'American Airlines Newsroom',
       'IHG Hotels & Resorts IR',
       'Hyatt Investor Relations',
       'Amazon Blog',
       'Shopify News',
     ],
     'Financial Institutions (JPMC, AmEx, Citi, Capital One)': [
       'JPMorgan Chase News',
       'American Express News',
       'Citigroup News',
       'Capital One News',
       'Bank of America News',
       'Wells Fargo News',
     ],
     'Payments Industry News': [
       'Visa News',
       'Mastercard News',
       'PayPal Newsroom',
       'Stripe News',
       'Adyen Blog',
       'Block (Square) News',
       'Marqeta Press Releases',
     ],
     'Startups (Chime, Stripe, Mercury, Sofi, Cardless, Bilt)': [
       'Chime Blog',
       'Stripe News',
       'Mercury Blog',
       'SoFi News',
       'Cardless News',
       'Bilt Rewards News',
       'Plaid Blog',
       'Affirm Press',
       'Revolut Blog',
       'Wise Blog',
     ],
   };

   export function categorizeByTheme(dailySummaries: any[]) {
     const themes: Record<string, any[]> = {};

     for (const [themeName, feedNames] of Object.entries(THEME_MAPPING)) {
       themes[themeName] = dailySummaries.filter(summary =>
         feedNames.includes(summary.feedName)
       );
     }

     return themes;
   }
   ```

3. **Update Gemini Prompt**

   File: [`src/lib/prompts.ts`](../src/lib/prompts.ts)

   ```typescript
   export const WEEKLY_RECAP_PROMPT = `You are a senior financial analyst and content strategist creating a weekly briefing for venture capital and fintech executives.

Generate a comprehensive weekly briefing with the following structure:

## WEEKLY THESIS (250-500 words)
Synthesize the week's most significant themes, trends, and strategic implications. Write in executive summary style with clear takeaways for decision-makers in fintech and venture capital.

## THEME HIGHLIGHTS

Organize stories into these exact themes:

1. FINTECH VENTURE CAPITAL
2. AIRLINES/HOTELS/ECOMMERCE LOYALTY
3. FINANCIAL INSTITUTIONS (JPMC, AMEX, CITI, CAPITAL ONE)
4. PAYMENTS INDUSTRY NEWS
5. STARTUPS (CHIME, STRIPE, MERCURY, SOFI, CARDLESS, BILT)

For each theme:
- List 2-5 most important stories
- Format: • [Headline] - [1-2 sentence summary with strategic context]
- Focus on strategic implications, not just events
- Prioritize by importance and relevance

## METADATA
Include these on separate lines at the end:
<<TITLE>>An engaging title (3-6 words) capturing the week's theme
<<TOPICS>>3-5 key topics/themes from the week
<<SIGNOFF>>Brief sign-off message (1-2 sentences)

Daily summaries to synthesize:
{summaries}

Previous context (avoid repetition):
{previousContext}

Write in a professional but engaging tone. Focus on what matters to fintech/VC executives.`;
   ```

4. **Update Parser**

   Update [`src/services/summarization/summarization-service.ts`](../src/services/summarization/summarization-service.ts) to extract the thesis section:

   ```typescript
   parseRecapSections(content: string): {
     thesis: string;
     themeHighlights: string;
     recapContent: string;
     belowTheFoldContent?: string;
     soWhatContent?: string;
   } {
     // Extract WEEKLY THESIS section
     const thesisMatch = content.match(/##\s*WEEKLY THESIS[^\n]*\n([\s\S]*?)(?=##|$)/i);
     const thesis = thesisMatch ? thesisMatch[1].trim() : '';

     // Extract THEME HIGHLIGHTS section
     const themeMatch = content.match(/##\s*THEME HIGHLIGHTS[^\n]*\n([\s\S]*?)(?=##|$)/i);
     const themeHighlights = themeMatch ? themeMatch[1].trim() : '';

     // Rest of content as recap
     const recapContent = content
       .replace(/##\s*WEEKLY THESIS[\s\S]*?(?=##|$)/i, '')
       .replace(/##\s*THEME HIGHLIGHTS[\s\S]*?(?=##|$)/i, '')
       .trim();

     return {
       thesis,
       themeHighlights,
       recapContent,
     };
   }
   ```

5. **Update Email Template**

   File: [`src/lib/email-templates/weekly-digest-template.ts`](../src/lib/email-templates/) (find the right template file)

   ```html
   <div style="max-width: 650px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
     <h1 style="font-size: 28px; margin-bottom: 10px;">
       {{{title}}}
     </h1>

     <div style="border-top: 3px solid #000; margin: 30px 0;"></div>

     <h2 style="font-size: 18px; letter-spacing: 2px; margin: 30px 0 20px;">
       WEEKLY THESIS
     </h2>

     <div style="border-top: 3px solid #000; margin-bottom: 30px;"></div>

     <div style="font-size: 16px; line-height: 1.6; margin-bottom: 40px;">
       {{{thesis}}}
     </div>

     <div style="border-top: 3px solid #000; margin: 40px 0;"></div>

     <h2 style="font-size: 18px; letter-spacing: 2px; margin: 30px 0 20px;">
       THEME HIGHLIGHTS
     </h2>

     <div style="border-top: 3px solid #000; margin-bottom: 30px;"></div>

     <div style="font-size: 15px; line-height: 1.7;">
       {{{themeHighlights}}}
     </div>

     <div style="border-top: 3px solid #000; margin: 40px 0;"></div>

     <p style="color: #666; font-size: 14px; text-align: center;">
       This briefing synthesized {{storyCount}} stories from {{sourceCount}} sources<br>
       from {{weekStart}} to {{weekEnd}}
     </p>
   </div>
   ```

### Testing the New Format

1. **Test with sample data:**
   ```bash
   pnpm trigger weekly-summary 2026-02-22 --force
   ```

2. **Verify structure:**
   - 250-500 word thesis
   - All 5 themes present
   - Stories properly categorized
   - Professional formatting

3. **Iterate on prompt:**
   - Adjust tone if too formal/casual
   - Refine thesis length
   - Improve theme categorization

---

## Implementation Priority

### Phase 1: Critical Fixes (Today)

1. **Fix validate-feeds cron** (1 hour)
   - Apply code fix
   - Deploy
   - Reset feeds to valid
   - Monitor tomorrow's validation run

2. **Add health check endpoint** (30 minutes)
   - Create endpoint
   - Deploy
   - Test with curl

### Phase 2: Monitoring (This Week)

3. **Set up external monitor** (15 minutes)
   - Create UptimeRobot account
   - Add health-check monitor
   - Configure email alerts

OR

3. **Add health monitor cron** (1 hour)
   - Create cron handler
   - Add to wrangler.toml
   - Deploy and test

### Phase 3: Email Restructure (Next Week)

4. **Implement theme mapping** (2 hours)
   - Create theme-mapping.ts
   - Map all current feeds to themes
   - Add theme categorization logic

5. **Update prompts** (1 hour)
   - Write new weekly thesis prompt
   - Update metadata extraction
   - Test with Gemini API

6. **Update email template** (1 hour)
   - Create new HTML template
   - Test rendering
   - Send test emails

7. **Iterate and refine** (ongoing)
   - Gather feedback
   - Adjust prompts
   - Refine themes

---

## Next Steps

**Immediate (Today):**
1. Review and approve this plan
2. Implement Phase 1 fixes
3. Test validate-feeds fix tomorrow morning

**This Week:**
1. Set up monitoring
2. Verify health checks working
3. Start Phase 3 planning

**Next Week:**
1. Implement email restructure
2. Test new format
3. Roll out to all recipients

---

## Questions for Consideration

1. **Monitoring:** Prefer external service (UptimeRobot) or internal cron?
2. **Email format:** Should we keep "below the fold" section or remove it?
3. **Themes:** Are the 5 themes comprehensive? Any to add/remove/combine?
4. **Thesis length:** Is 250-500 words the right range?
5. **Frequency:** Keep weekly or add daily briefing option?

---

**Files to Modify:**
- [ ] `src/server-functions/queues/feed-fetch-consumer.ts` (validate function)
- [ ] `src/server-functions/http/health-check.ts` (new file)
- [ ] `src/server-functions/crons/health-monitor.ts` (new file, optional)
- [ ] `src/lib/theme-mapping.ts` (new file)
- [ ] `src/lib/prompts.ts` (weekly recap prompt)
- [ ] `src/services/summarization/summarization-service.ts` (parser)
- [ ] Email template file (find and update)
- [ ] `src/index.ts` (add routes/crons)
- [ ] `wrangler.toml` (add health monitor cron if using option B)

**Estimated Total Time:**
- Phase 1: 1.5 hours
- Phase 2: 1 hour
- Phase 3: 4-6 hours
- **Total: 6.5-8.5 hours** over 2 weeks

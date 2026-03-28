# Browser Rendering Setup Guide

This guide walks you through enabling Cloudflare Browser Rendering for your premium JavaScript-heavy feed sources.

## 🎯 Overview

You've configured 13 high-value feeds with `type: "browser"` that require JavaScript execution:
- 4 VC Insights feeds (Sequoia, a16z, Bessemer, Greylock)
- 3 Enterprise Payments feeds (JPMorgan, Visa, Adyen)
- 6 FinTech 50 & Infrastructure feeds (Stripe, Plaid, Ramp, Securitize, Ondo, Fireblocks)

## 💰 Cost: ~$5/month

- **Workers Paid Plan**: $5/month base
- **Included**: 10M requests + 30M CPU-milliseconds
- **Your Usage**: ~60 browser requests/month (once weekly)
- **Billing**: CPU time only (not wall time waiting for JS)
- **Storage**: R2 has $0 egress fees

## 📋 Prerequisites

- [x] Browser adapter implemented (`src/services/feed/adapters/browser-adapter.ts`)
- [x] FeedService updated to support browser type
- [x] 13 premium feeds configured in `config/feeds.yaml`
- [ ] Upgrade to Cloudflare Workers Paid plan
- [ ] Enable Browser Rendering in Cloudflare dashboard
- [ ] Configure browser binding in wrangler.toml
- [ ] Install dependencies
- [ ] Deploy updated worker

## 🚀 Step-by-Step Implementation

### Step 1: Upgrade to Workers Paid Plan

1. Log into your Cloudflare dashboard
2. Navigate to **Workers & Pages**
3. Go to **Plans** section
4. Click **Upgrade to Paid** ($5/month)
5. Confirm the upgrade

### Step 2: Enable Browser Rendering

1. In Cloudflare dashboard, go to **Workers & Pages**
2. Navigate to **Browser Rendering**
3. Click **Enable Browser Rendering**
4. Confirm that you understand the pricing

### Step 3: Configure Browser Binding

Add the browser binding to your `wrangler.toml`:

```toml
# Add this to your wrangler.toml file
[browser]
binding = "BROWSER"
```

**Full Example (add to existing file):**
```toml
name = "briefings"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# ... existing bindings ...

# Browser Rendering Binding
[browser]
binding = "BROWSER"
```

### Step 4: Install Dependencies

```bash
pnpm install
```

This installs `@cloudflare/puppeteer` which was added to `package.json`.

### Step 5: Deploy

```bash
pnpm deploy
```

## 🧪 Testing

Test the browser rendering with a single feed:

```bash
# Sync feeds to ensure browser-type feeds are in the database
pnpm sync:feeds

# Manually trigger feed fetch
pnpm trigger feed-fetch
```

Check the logs:
```bash
pnpm tail
```

Look for log entries like:
- `"Launching browser session"` - Browser adapter is working
- `"Successfully scraped with browser"` - Articles extracted
- `"Browser scraping failed"` - Errors (check BROWSER binding)

## 🔧 Troubleshooting

### Error: "Browser rendering requires...BROWSER binding"

**Cause**: Browser binding not configured or not deployed

**Fix**:
1. Add `[[browser]]` section to `wrangler.toml` (see Step 3)
2. Deploy: `pnpm deploy`
3. Verify binding appears in deployment output

### Error: "Browser Rendering API not enabled"

**Cause**: Feature not enabled in Cloudflare dashboard

**Fix**:
1. Go to Cloudflare dashboard → Workers & Pages → Browser Rendering
2. Click "Enable"
3. Redeploy: `pnpm deploy`

### No articles extracted from browser feeds

**Cause**: Selector may not match rendered DOM

**Fix**:
1. Test selector manually using browser dev tools
2. Update selector in `config/feeds.yaml`
3. Run `pnpm sync:feeds`
4. Trigger feed fetch again

### High costs

**Cause**: Browser feeds running too frequently

**Fix**:
- Browser feeds should run once weekly max
- Create dedicated cron job (see Step 6 below)
- Don't mix browser feeds with regular feed fetch

## 🗓️ Step 6: Dedicated Weekly Cron (Recommended)

To control costs, create a separate cron job that only runs browser feeds once weekly:

### Option A: Separate Cron (Recommended)

**Add to `src/index.ts`:**
```typescript
// Add new cron mapping
const cronMap = {
  '0 */4 * * *': feedFetchCron,      // RSS/scrape feeds every 4h
  '0 10 * * *': dailySummaryCron,
  '0 6 * * *': validateFeedsCron,
  '0 13 * * 7': weeklyDigestCron,
  '0 */6 * * *': healthMonitorCron,
  '0 9 1 * *': monthlyReportCron,
  '0 9 * * 5': browserFeedsCron,     // Browser feeds Fridays 9 AM UTC only
};
```

**Create `src/server-functions/crons/browser-feeds.ts`:**
```typescript
import { Logger } from '../../lib/logger.js';
import { QueueDispatcher } from '../utils/queue-dispatcher.js';
import { getDb, setupDb } from '../../db.js';

export async function scheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const logger = Logger.forService('BrowserFeedsCron');
  logger.info('Browser feeds cron triggered');

  await setupDb(env);
  const db = getDb(env);

  // Get only browser-type feeds
  const browserFeeds = await db
    .selectFrom('Feed')
    .selectAll()
    .where('isActive', '=', 1)
    .where('type', '=', 'browser')
    .execute();

  logger.info('Found browser feeds', { count: browserFeeds.length });

  const queueDispatcher = QueueDispatcher.create(env);

  for (const feed of browserFeeds) {
    await queueDispatcher.sendFeedFetchMessage({
      feedUrl: feed.url,
      feedName: feed.name,
      feedId: feed.id,
      action: 'fetch',
    });
  }

  logger.info('Queued browser feed fetch jobs', {
    feedCount: browserFeeds.length,
  });
}
```

**Add to `wrangler.toml`:**
```toml
[[triggers.crons]]
crons = ["0 9 * * 5"]  # Fridays at 9 AM UTC
```

### Option B: Filter in Existing Cron

Update `src/server-functions/crons/initiate-feed-fetch.ts` to skip browser feeds:

```typescript
// Get active feeds, excluding browser types
const activeFeeds = await db
  .selectFrom('Feed')
  .selectAll()
  .where('isActive', '=', 1)
  .where('type', '!=', 'browser')  // Skip browser feeds
  .execute();
```

Then use dedicated cron from Option A for browser feeds.

## 📊 Monitoring

Watch for these metrics in your logs:

- **Browser session count**: Should be ~13-15 per week
- **CPU time usage**: Check Cloudflare dashboard
- **Success rate**: Monitor how many feeds succeed
- **Article count**: Ensure you're getting content

## 🎉 Success Criteria

You'll know it's working when:

1. ✅ Deployment shows `BROWSER` binding
2. ✅ Weekly health email shows browser feeds as valid
3. ✅ Articles appear in database from Sequoia, a16z, Stripe, etc.
4. ✅ Cloudflare billing shows only $5/month base cost
5. ✅ Weekly digest includes content from premium sources

## 📚 Additional Resources

- [Cloudflare Browser Rendering Docs](https://developers.cloudflare.com/browser-rendering/)
- [Puppeteer API Reference](https://pptr.dev/)
- [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)

## 🆘 Support

If you encounter issues:
1. Check logs: `pnpm tail`
2. Verify binding in deployment output
3. Test with a single feed first
4. Check Cloudflare dashboard for quota usage

# Cost Optimization Guide

This document explains the cost optimizations implemented in the Briefings system.

## Overview

The system is optimized to minimize Cloudflare Workers costs while maintaining full functionality. The primary optimization is separating expensive browser rendering from regular RSS/scrape feed fetching.

## Cost Breakdown

### Current Monthly Costs: ~$5.00

| Component | Cost | Notes |
|-----------|------|-------|
| Workers Paid Plan | $5.00 | Base plan required for browser rendering |
| Regular feed fetches | $0.00 | Well within free tier (10M requests included) |
| Browser rendering | ~$0.10 | ~13 browser sessions/week × 4 weeks = 52 sessions/month |
| Daily summaries | $0.00 | Gemini API is free tier |
| Weekly digests | $0.00 | Gemini API is free tier |
| R2 storage | $0.00 | Free egress, minimal storage |
| D1 database | $0.00 | Free tier (5GB storage, 5M reads/day) |

**Total: ~$5.10/month**

## Optimizations Implemented

### 1. Dedicated Browser Feeds Cron (Primary Optimization)

**Problem:** Browser rendering is expensive (CPU time charged). Running browser feeds every 4 hours wastes resources.

**Solution:** Separate cron schedules for different feed types.

**Implementation:**
- Regular RSS/scrape feeds: Every 4 hours (`0 */4 * * *`)
- Browser feeds only: Once weekly on Fridays (`0 9 * * 5`)

**Cost Savings:**
- Before: 42 browser sessions/week (every 4h × 13 feeds)
- After: 13 browser sessions/week (once weekly × 13 feeds)
- **Savings: 69% reduction in browser rendering costs**

**Files Changed:**
- `src/server-functions/crons/browser-feeds.ts` - New dedicated browser feeds cron
- `src/server-functions/crons/initiate-feed-fetch.ts` - Excludes browser feeds
- `src/index.ts` - Added browser feeds cron mapping
- `wrangler.toml` - Added new cron schedule

### 2. Browser Rendering Cost Model

**How Cloudflare Charges:**
- CPU time only (NOT wall time waiting for JavaScript)
- ~$0.002 per browser session (estimate)
- No charge for network idle time

**Why This Matters:**
- Browser waits for `networkidle0` (no requests for 500ms)
- Plus 2-second buffer for lazy-loaded content
- Total wall time: ~5-10 seconds per page
- Actual CPU time: ~1-2 seconds (charged time)

**Optimization Tips:**
- Keep selectors efficient (single DOM query vs multiple)
- Don't run browser feeds more than weekly
- Premium content (VC blogs, fintech) updates weekly anyway

### 3. Feed Type Distribution

**Current Feed Breakdown (72 total):**
- RSS feeds: 48 feeds (67%) - Free to fetch
- Scrape feeds: 11 feeds (15%) - Minimal cost (HTTP fetch only)
- Browser feeds: 13 feeds (18%) - Expensive (headless Chrome)

**Schedule:**
- 59 feeds every 4 hours (RSS + scrape)
- 13 feeds once weekly (browser)

### 4. Queue Batching Optimization

**Queue Consumer Settings:**
- `feed-fetch`: max_batch_size = 10 (parallel processing)
- `daily-summary-processor`: max_batch_size = 5 (API rate limiting)
- `weekly-digest`: max_batch_size = 1 (single digest per week)

**Benefits:**
- Fewer queue consumer invocations
- Better resource utilization
- Reduced cold start overhead

### 5. Gemini API Free Tier Usage

**Current Usage:**
- Daily summaries: ~60 summaries/day (1 per feed)
- Weekly digests: 1 comprehensive digest/week
- Total tokens: ~2-3M tokens/month

**Free Tier Limits:**
- Gemini 1.5 Flash: 15 RPM, 1M TPM (tokens per minute)
- Gemini 1.5 Pro: 2 RPM, 32K TPM
- **Well within limits**

### 6. R2 Storage Optimization

**Why R2 vs Other Storage:**
- $0 egress fees (vs S3's egress charges)
- Free tier: 10GB storage
- Perfect for digest history storage

**Current Usage:**
- ~1MB per weekly digest
- ~52MB per year
- **Cost: $0.00** (well within free tier)

## Cost Monitoring

### Key Metrics to Watch

1. **Browser Session Count**
   - Expected: ~13 sessions/week (52/month)
   - Monitor in logs: "Launching browser session"
   - Alert if exceeds 20 sessions/week

2. **CPU Time Usage**
   - Check Cloudflare dashboard: Workers & Pages → Analytics
   - Expected: <1 second CPU per browser session
   - Alert if approaching 10M CPU-milliseconds (paid tier limit)

3. **Queue Message Count**
   - Expected: ~1,500 messages/day (60 feeds × 6 fetches/day)
   - Monitor in Cloudflare dashboard
   - Alert if exceeds 5,000 messages/day

4. **Gemini API Usage**
   - Check Google AI Studio console
   - Expected: 2-3M tokens/month
   - Alert if approaching free tier limits

### Cost Alerts

Set up alerts in Cloudflare dashboard:
- CPU time > 8M milliseconds/month (80% of free tier)
- Browser sessions > 100/month (unusual activity)
- Queue messages > 100K/month (potential infinite loop)

## Future Optimization Opportunities

### 1. Conditional Browser Rendering

Only use browser rendering when necessary:
- First try RSS feed
- If no content, fallback to scraping
- If scraping fails, use browser

**Potential Savings:** 20-30% reduction in browser sessions

### 2. Feed Fetch Frequency Adjustment

Current: Every 4 hours for RSS/scrape feeds

**Optimization Options:**
- High-priority feeds: Every 2 hours
- Medium-priority feeds: Every 6 hours
- Low-priority feeds: Twice daily

**Potential Savings:** 30-40% reduction in feed fetches

### 3. Caching Layer

Add KV caching for:
- Feed content (cache for 1 hour)
- Daily summaries (cache for 24 hours)
- Reduce redundant fetches

**Potential Savings:** 10-20% reduction in HTTP requests

### 4. Smart Scheduling

Schedule feed fetches based on:
- Historical update frequency
- Time zone of content source
- Day of week patterns

**Example:**
- TechCrunch: Peak posting 9am-5pm ET
- VC blogs: Usually Tuesdays/Thursdays
- Fintech: Business hours only

**Potential Savings:** 20-30% reduction in unnecessary fetches

## Summary

The current system is highly optimized with monthly costs of ~$5.00. The primary optimization—separating browser feeds from regular feeds—saves ~69% on browser rendering costs.

**Key Takeaways:**
1. Browser rendering is the only significant cost
2. Running browser feeds weekly (not every 4h) is the main optimization
3. All other components are within free tiers
4. System is over-provisioned for reliability, not cost

**Recommendation:** Current configuration balances cost and freshness optimally. No further optimizations needed unless scaling to 100+ feeds.

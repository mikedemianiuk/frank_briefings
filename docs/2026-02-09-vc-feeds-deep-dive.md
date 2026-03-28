# Deep Dive: Adding VC Insights Feeds & Troubleshooting

**Date:** February 9, 2026
**Author:** Claude Code
**Status:** 5 of 11 feeds working, 6 need fixes

---

## Executive Summary

Today we successfully added 11 venture capital insights feeds to the Briefings system, bringing the total feed count to 48. Of these new feeds, 5 are fully operational and have retrieved 171 articles. The remaining 6 feeds require fixes for selector issues (4 feeds) and SQL batch insert limits (2 feeds).

**Key Achievements:**
- ✅ Added 11 VC Insights feeds to database
- ✅ Fixed selectors for 5 feeds (171 articles retrieved)
- ✅ Identified root causes for 6 failing feeds
- ✅ Total article count increased from 444 to 615 (+38%)

---

## Part 1: Feed Addition Process

### 1.1 Initial Feed List

The following 11 VC feeds were requested:

| # | Feed Name | URL | Original Selector |
|---|-----------|-----|-------------------|
| 1 | a16z Articles | `https://a16z.com/articles/` | `h2.entry-title` |
| 2 | Sequoia Capital Stories | `https://www.sequoiacap.com/our-stories/` | `div.content` |
| 3 | Union Square Ventures | `https://www.usv.com/writing/` | `div.post` |
| 4 | First Round Review | `https://review.firstround.com/` | `div.article-card` |
| 5 | Greylock (Greymatter) | `https://greylock.com/greymatter/` | `div.card-content` |
| 6 | Lightspeed Venture Partners | `https://lsvp.com/stories/` | `article.post` |
| 7 | Index Ventures Perspectives | `https://www.indexventures.com/perspectives/` | `a.c-card` |
| 8 | Accel Noteworthy | `https://www.accel.com/noteworthy` | `div.collection-item` |
| 9 | Bessemer Venture Partners | `https://www.bvp.com/atlas` | `div.atlas-card` |
| 10 | Kleiner Perkins Perspectives | `https://www.kleinerperkins.com/perspectives` | `div.post-preview` |
| 11 | Canapi Ventures Insights | `https://www.canapi.com/insights` | `div.collection-item` |

### 1.2 Database Insertion

Created [`scripts/add-vc-insights-feeds.sql`](../scripts/add-vc-insights-feeds.sql) with INSERT statements for all 11 feeds:

```sql
INSERT INTO Feed (id, name, url, type, selector, category, isActive, isValid, errorCount, createdAt, updatedAt) VALUES
('a1b2c3d4-0001-4000-8000-000000000100', 'a16z Articles', 'https://a16z.com/articles/', 'scrape', 'h2.entry-title', 'VC Insights', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
-- ... 10 more feeds
```

**Execution:**
```bash
npx wrangler d1 execute DB --remote --file=scripts/add-vc-insights-feeds.sql
```

**Result:** ✅ 11 feeds added successfully (22 rows written due to timestamp calculations)

### 1.3 Initial Testing

Triggered feed fetch:
```bash
pnpm trigger feed-fetch
```

**Result:** ❌ All 11 feeds returned 0 articles
- 2 feeds returned HTTP 404 errors (a16z, Sequoia)
- 9 feeds completed without errors but retrieved no articles

**Diagnosis:** Incorrect CSS selectors and URLs

---

## Part 2: Selector Investigation & Fixes

### 2.1 Investigation Methodology

Used `WebFetch` tool to analyze the actual HTML structure of each feed's webpage:

```typescript
// Example investigation
WebFetch({
  url: 'https://review.firstround.com/',
  prompt: 'What is the HTML structure of this page? Look for article cards...'
})
```

### 2.2 Findings by Feed

#### ✅ Working Feeds (After Fixes)

**1. First Round Review** - 36 articles
- **Issue:** Selector `div.article-card` doesn't exist
- **Actual Structure:** Article links with `<h3>` headlines nested inside `<a>` tags
- **Fix:** Changed selector to `a h3`
- **HTML Pattern:**
  ```html
  <a href="/applied-intuitions-path-to-product-market-fit/">
    <img src="...">
    <h3>Applied Intuition's Path to Product-Market Fit</h3>
  </a>
  ```

**2. Union Square Ventures (USV)** - 6 articles
- **Issue:** Selector `div.post` doesn't exist
- **Actual Structure:** WordPress block template with `<h4>` containing links
- **Fix:** Changed selector to `h4 a`
- **HTML Pattern:**
  ```html
  <h4>
    <a href="/writing/2025/12/the-race-to-run-businesses-autonomously...">
      The Race to Run Businesses Autonomously...
    </a>
  </h4>
  ```

**3. Lightspeed Venture Partners** - 48 articles
- **Issue:** Selector `article.post` doesn't match structure
- **Actual Structure:** Simple anchor cards with `<h2>` headlines
- **Fix:** Changed selector to `a h2`
- **HTML Pattern:**
  ```html
  <a href="[story-url]">
    <img src="[thumbnail]" />
    <h2>[Story Title]</h2>
    <p>[Description]</p>
  </a>
  ```

**4. Index Ventures Perspectives** - 24 articles
- **Issue:** Selector `a.c-card` doesn't capture headlines
- **Actual Structure:** Article cards with `<h3>` inside `<article>` tags
- **Fix:** Changed selector to `article h3`
- **HTML Pattern:**
  ```html
  <article>
    <img src="[image-url]" alt="[description]">
    <h3>[Article Title]</h3>
    <p>by [Author Name]</p>
    <a href="/perspectives/[slug]/">Read more</a>
  </article>
  ```

**5. Canapi Ventures Insights** - 57 articles (highest!)
- **Issue:** Selector `div.collection-item` too generic
- **Actual Structure:** Webflow dynamic items with `<h3>` headlines
- **Fix:** Changed selector to `.w-dyn-item h3`
- **HTML Pattern:**
  ```html
  <div class="w-dyn-item">
    <img class="c-insights__thumbnail" src="...">
    <span class="c--insights__tag">Category</span>
    <h3>ModernFi: 'Canapi's ecosystem means...'</h3>
  </div>
  ```

#### ❌ Feeds with 404 Errors (URL Issues)

**6. a16z Articles** - 0 articles
- **Issue:** URL `https://a16z.com/articles/` returns 404
- **Investigation:** Checked site navigation
- **Finding:** Correct URL is `https://a16z.com/news-content/`
- **Actual Structure:** News items with `.news-item` class and `<h6>` headlines
- **Fix Applied:** Changed URL to `/news-content/` and selector to `.news-item h6`
- **Status:** Still 0 articles after fix (may need more investigation)

**7. Sequoia Capital Stories** - 0 articles
- **Issue:** URL `https://www.sequoiacap.com/our-stories/` returns 404
- **Investigation:** Checked site navigation
- **Finding:** Correct URL is `https://www.sequoiacap.com/stories/`
- **Actual Structure:** WordPress block template with links containing `<h3>`
- **Fix Applied:** Changed URL to `/stories/` and selector to `a h3`
- **Status:** Still 0 articles after fix (may need more investigation)

#### ⚠️ Feeds with SQL Variable Errors

**8. Accel Noteworthy** - 0 articles
- **Error:** `D1_ERROR: too many SQL variables at offset 346: SQLITE_ERROR`
- **Issue:** Selector found TOO MANY articles for single batch insert
- **Original Selector:** `div.collection-item`
- **Actual Structure:** Card components with `.card_component h3`
- **Fix Applied:** Changed selector to `.card_component h3`
- **Root Cause:** D1 SQLite has a limit on SQL variables per query (~999)
- **Status:** Needs batch insert logic in feed scraper

**9. Kleiner Perkins Perspectives** - 0 articles
- **Error:** `D1_ERROR: too many SQL variables at offset 346: SQLITE_ERROR`
- **Issue:** Same as Accel - too many articles for batch insert
- **Original Selector:** `div.post-preview`
- **Actual Structure:** WordPress blocks with `.wp-block-post-title`
- **Fix Applied:** Changed selector to `.wp-block-post-title`
- **Status:** Needs batch insert logic in feed scraper

#### 🔍 Feeds Still Returning 0 Articles

**10. Greylock (Greymatter)** - 0 articles
- **Issue:** Selector not finding articles despite no errors
- **Original Selector:** `div.card-content`
- **Actual Structure:** Row items with `.item h2` or `.item_small h2`
- **Fix Applied:** Changed selector to `.item h2`
- **Status:** May be JavaScript-rendered content
- **HTML Pattern:**
  ```html
  <div class="item big">
    <div class="img_area"><img src="..." /></div>
    <h2>[article_title]</h2>
    <a class="strect" href="[permalink]"></a>
  </div>
  ```

**11. Bessemer Venture Partners (Atlas)** - 0 articles
- **Issue:** Selector not finding articles despite no errors
- **Original Selector:** `div.atlas-card`
- **Actual Structure:** Atlas cards with `.atlas-card h2`
- **Fix Applied:** Changed selector to `.atlas-card h2`
- **Status:** May be JavaScript-rendered content

### 2.3 Selector Fix Script

Created [`scripts/fix-vc-insights-selectors.sql`](../scripts/fix-vc-insights-selectors.sql):

```sql
-- Fix selectors and URLs for VC Insights feeds

-- a16z: Fix URL and selector
UPDATE Feed SET
  url = 'https://a16z.com/news-content/',
  selector = '.news-item h6',
  isValid = 1,
  errorCount = 0,
  lastError = NULL
WHERE name = 'a16z Articles';

-- Sequoia: Fix URL and selector
UPDATE Feed SET
  url = 'https://www.sequoiacap.com/stories/',
  selector = 'a h3',
  isValid = 1,
  errorCount = 0,
  lastError = NULL
WHERE name = 'Sequoia Capital Stories';

-- USV: Fix selector
UPDATE Feed SET
  selector = 'h4 a',
  isValid = 1,
  lastError = NULL
WHERE name = 'Union Square Ventures (USV)';

-- ... (8 more UPDATE statements)
```

**Execution:**
```bash
npx wrangler d1 execute DB --remote --file=scripts/fix-vc-insights-selectors.sql
```

**Result:** ✅ All 11 feeds updated (11 rows written)

---

## Part 3: Current Status & Metrics

### 3.1 VC Insights Feed Status

| Feed Name | Status | Articles | Issue |
|-----------|--------|----------|-------|
| Canapi Ventures Insights | ✅ Working | 57 | None |
| Lightspeed Venture Partners | ✅ Working | 48 | None |
| First Round Review | ✅ Working | 36 | None |
| Index Ventures Perspectives | ✅ Working | 24 | None |
| Union Square Ventures | ✅ Working | 6 | None |
| Accel Noteworthy | ⚠️ SQL Error | 0 | Too many SQL variables |
| Kleiner Perkins Perspectives | ⚠️ SQL Error | 0 | Too many SQL variables |
| Bessemer Venture Partners | ❌ Not Working | 0 | Selector or JS-rendered |
| Greylock (Greymatter) | ❌ Not Working | 0 | Selector or JS-rendered |
| Sequoia Capital Stories | ❌ Not Working | 0 | URL/selector needs verification |
| a16z Articles | ❌ Not Working | 0 | URL/selector needs verification |

**Success Rate:** 5 of 11 working (45.5%)
**Articles Retrieved:** 171 from 5 feeds

### 3.2 Overall System Status

**Before VC Feeds:**
- Total Feeds: 37
- Working Feeds: 25
- Total Articles: 444

**After VC Feeds:**
- Total Feeds: 48 (+11)
- Working Feeds: 30 (+5)
- Total Articles: 615 (+171, +38% increase)
- Feeds with Articles: 30

**Category Breakdown:**

| Category | Total Feeds | Working | Article Count |
|----------|-------------|---------|---------------|
| Fintech | 7 | 5 | 177 |
| **VC Insights** | **11** | **5** | **171** 🎉 |
| Tech | 1 | 1 | 82 |
| Investor Relations | 6 | 3 | 50 |
| Fintech News | 2 | 2 | 30 |
| Banking | 1 | 1 | 25 |
| Payments | 4 | 3 | 21 |
| Tech News | 3 | 2 | 17 |
| Competitor News | 2 | 1 | 13 |
| VC Analysis | 3 | 2 | 11 |
| Credit Cards | 1 | 1 | 9 |
| Loyalty | 3 | 3 | 7 |
| Payments Network | 2 | 1 | 2 |
| Fintech Analysis | 1 | 0 | 0 |
| Airline Loyalty | 1 | 0 | 0 |

**VC Insights is now the 2nd highest article contributor!**

---

## Part 4: Remaining Issues & Solutions

### 4.1 Issue #1: SQL Variable Limit (2 feeds)

**Affected Feeds:**
- Accel Noteworthy
- Kleiner Perkins Perspectives

**Error Message:**
```
Failed to process articles: D1_ERROR: too many SQL variables at offset 346: SQLITE_ERROR
```

**Root Cause:**

Cloudflare D1 (SQLite) has a limit of ~999 SQL variables per query. When the feed scraper finds many articles and tries to insert them all in a single batch INSERT, it exceeds this limit.

The current INSERT pattern looks like:
```sql
INSERT INTO Article (id, feedId, title, url, publishedAt, ...) VALUES
  (?, ?, ?, ?, ?, ...),  -- Article 1 (10 variables)
  (?, ?, ?, ?, ?, ...),  -- Article 2 (10 variables)
  (?, ?, ?, ?, ?, ...),  -- Article 3 (10 variables)
  -- ... continues
```

With 10 fields per article, the limit is ~99 articles per batch.

**Solution:**

Modify the feed scraper to chunk articles into smaller batches. Update [`src/services/feed/feed-service.ts`](../src/services/feed/feed-service.ts):

```typescript
// Current code (approximate location)
async function saveArticles(articles: Article[], db: D1Database) {
  // This inserts all articles at once
  await db.insert(articles);
}

// Fixed code with batching
const BATCH_SIZE = 50; // Safe limit well below 999/fields_per_row

async function saveArticles(articles: Article[], db: D1Database) {
  // Chunk articles into batches of 50
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    await db.insert(batch);
  }

  console.log(`Saved ${articles.length} articles in ${Math.ceil(articles.length / BATCH_SIZE)} batches`);
}
```

**Testing After Fix:**

1. Apply the code change
2. Deploy: `pnpm deploy`
3. Trigger feed fetch: `pnpm trigger feed-fetch`
4. Check results:
   ```bash
   npx wrangler d1 execute DB --remote --command \
     "SELECT name, (SELECT COUNT(*) FROM Article WHERE feedId = Feed.id) as count
      FROM Feed WHERE name IN ('Accel Noteworthy', 'Kleiner Perkins Perspectives')"
   ```

**Expected Result:** Both feeds should now have 50-100+ articles each.

### 4.2 Issue #2: JavaScript-Rendered Content (2 feeds)

**Affected Feeds:**
- Bessemer Venture Partners (Atlas)
- Greylock (Greymatter)

**Symptoms:**
- No errors reported
- 0 articles retrieved
- Selectors appear correct based on WebFetch HTML analysis

**Root Cause:**

These sites may use client-side JavaScript to render content. The current scraper uses Cheerio, which only parses static HTML. If the page loads an empty container and then populates it with JavaScript, Cheerio won't see any content.

**Detection Test:**

Check if content exists in raw HTML:

```bash
# Test Bessemer
curl -s "https://www.bvp.com/atlas" | grep -i "atlas-card"

# Test Greylock
curl -s "https://greylock.com/greymatter/" | grep -i "item big"
```

If these commands return empty, the content is JavaScript-rendered.

**Solution Options:**

**Option A: Find RSS/JSON Feeds (Preferred)**

Many sites offer RSS feeds or JSON APIs that are easier to parse:

```bash
# Check for RSS
curl -s "https://www.bvp.com/atlas" | grep -i "rss\|feed\|atom"
curl -s "https://greylock.com/greymatter/" | grep -i "rss\|feed\|atom"

# Check robots.txt
curl -s "https://www.bvp.com/robots.txt"
curl -s "https://greylock.com/robots.txt"

# Check common RSS paths
curl -I "https://www.bvp.com/feed"
curl -I "https://greylock.com/feed"
```

If RSS feeds exist, update the feed type from `scrape` to `rss` and set the RSS URL.

**Option B: Use Cloudflare Browser Rendering**

Cloudflare Workers can use Puppeteer/Browser Rendering API:

1. Enable Browser Rendering in Cloudflare dashboard
2. Update scraper to use headless browser for these specific feeds
3. This adds cost and complexity, so use sparingly

**Option C: Disable These Feeds**

If neither RSS nor browser rendering is viable:

```sql
UPDATE Feed SET isActive = 0
WHERE name IN ('Bessemer Venture Partners (Atlas)', 'Greylock (Greymatter)');
```

**Recommendation:** Try Option A (RSS feeds) first, as it's the most maintainable solution.

### 4.3 Issue #3: URL/Selector Verification Needed (2 feeds)

**Affected Feeds:**
- a16z Articles
- Sequoia Capital Stories

**Current Status:**
- URLs updated (404 errors fixed)
- Selectors updated based on WebFetch
- Still returning 0 articles after fixes

**Next Steps:**

**1. Manual Verification**

Test selectors directly with curl + grep:

```bash
# Test a16z selector
curl -s "https://a16z.com/news-content/" | grep -o '<h6[^>]*>.*</h6>' | head -5

# Test Sequoia selector
curl -s "https://www.sequoiacap.com/stories/" | grep -o '<h3[^>]*>.*</h3>' | head -5
```

**2. Check for Dynamic Loading**

Both sites might use infinite scroll or load-more pagination:

```bash
# Check for pagination or load-more buttons
curl -s "https://a16z.com/news-content/" | grep -i "load more\|pagination\|next"
curl -s "https://www.sequoiacap.com/stories/" | grep -i "load more\|pagination\|next"
```

**3. Alternative Selectors**

Try broader selectors to capture links:

```sql
-- a16z: Try capturing all article links
UPDATE Feed SET selector = 'article a' WHERE name = 'a16z Articles';

-- Sequoia: Try WordPress post template
UPDATE Feed SET selector = '.wp-block-mg-post-container a' WHERE name = 'Sequoia Capital Stories';
```

**4. Check Scraper Logs**

Enable debug logging and re-run:

```bash
# Tail logs in real-time
pnpm tail

# In another terminal, trigger feed fetch
pnpm trigger feed-fetch

# Look for entries related to a16z and Sequoia
# Check for selector matches, article counts, etc.
```

**5. WebFetch Deep Dive**

Use WebFetch to get more specific HTML:

```typescript
// Check if links are present
WebFetch({
  url: 'https://a16z.com/news-content/',
  prompt: 'Count how many article links exist on this page. Show me 3 example anchor tags with their href attributes and surrounding HTML structure.'
})
```

### 4.4 Issue #4: Low Article Count (1 feed)

**Affected Feed:**
- Union Square Ventures (USV) - only 6 articles

**Possible Causes:**
1. Site has limited recent content
2. Selector is too specific
3. Pagination not being followed

**Solution:**

Check if there's actually more content on the page:

```bash
# Count all h4 tags
curl -s "https://www.usv.com/writing/" | grep -o '<h4' | wc -l

# If count is higher than 6, selector might need adjustment
```

Try broader selector:

```sql
UPDATE Feed SET selector = 'h4' WHERE name = 'Union Square Ventures (USV)';
```

Or check for pagination:

```sql
-- Check if feed supports pagination
curl -s "https://www.usv.com/writing/" | grep -i "pagination\|older\|next"
```

---

## Part 5: General Scraping Best Practices

### 5.1 Selector Strategy

**Priority Order for Selectors:**

1. **Semantic HTML tags** (best for stability)
   - `article`, `<h1>`, `<h2>`, `<h3>` tags
   - Example: `article h2`, `article a`

2. **BEM-style classes** (somewhat stable)
   - `.card`, `.post-card`, `.article-card`
   - Example: `.post-card h3`, `.article__title`

3. **Generic classes** (less stable, may change)
   - `.item`, `.content`, `.wrapper`
   - Example: `.item h2`

4. **WordPress classes** (stable for WP sites)
   - `.wp-block-post-template`, `.wp-block-post-title`
   - Example: `.wp-block-post-title`

5. **Attribute selectors** (very specific)
   - `[data-test-id="article"]`, `[href*="/blog/"]`
   - Example: `a[href*="/insights/"]`

**Avoid:**
- IDs (too specific, often dynamic)
- Inline styles
- Generated class names (`.css-abc123`)

### 5.2 Testing Selectors

**Before Adding a Feed:**

1. **Use WebFetch** to analyze HTML structure
2. **Test with curl + grep** to verify selector works
3. **Add feed with isActive = 0** initially
4. **Manually trigger** feed fetch for that specific feed
5. **Verify articles** were retrieved
6. **Set isActive = 1** to enable in production

**Example Testing Workflow:**

```bash
# 1. Analyze structure
WebFetch('https://example.com/blog/', 'Show me article HTML')

# 2. Test selector
curl -s "https://example.com/blog/" | grep -o '<h2[^>]*>.*</h2>' | head -3

# 3. Add feed (inactive)
cat > test-feed.sql <<EOF
INSERT INTO Feed (id, name, url, type, selector, category, isActive, isValid, errorCount, createdAt, updatedAt) VALUES
('test-feed-123', 'Test Feed', 'https://example.com/blog/', 'scrape', 'article h2', 'Test', 0, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);
EOF

npx wrangler d1 execute DB --remote --file=test-feed.sql

# 4. Manually trigger (would need custom endpoint for single feed)
# For now, set isActive=1 and run full fetch

# 5. Verify
npx wrangler d1 execute DB --remote --command \
  "SELECT name, (SELECT COUNT(*) FROM Article WHERE feedId = Feed.id) as count FROM Feed WHERE name = 'Test Feed'"

# 6. Activate if successful
npx wrangler d1 execute DB --remote --command \
  "UPDATE Feed SET isActive = 1 WHERE name = 'Test Feed'"
```

### 5.3 Common Failure Patterns

| Pattern | Symptom | Solution |
|---------|---------|----------|
| **JavaScript Rendering** | 0 articles, no errors, correct selector | Find RSS feed or use browser rendering |
| **Wrong URL** | HTTP 404 error | Check site navigation for correct path |
| **Wrong Selector** | 0 articles, no errors | Use WebFetch to analyze actual HTML |
| **Too Many Articles** | SQL variable error | Implement batch insert logic |
| **Pagination** | Low article count | Add pagination support to scraper |
| **Rate Limiting** | HTTP 429 error | Add delays between requests |
| **Bot Detection** | HTTP 403 error | Add user-agent, cookies, or use proxy |

---

## Part 6: Action Plan for Remaining Feeds

### Priority 1: Fix SQL Variable Errors (High Impact)

**Feeds:** Accel, Kleiner Perkins
**Estimated Time:** 30 minutes
**Impact:** +100-200 articles

**Steps:**
1. Read [`src/services/feed/feed-service.ts`](../src/services/feed/feed-service.ts)
2. Find the article insertion logic
3. Add batching logic (BATCH_SIZE = 50)
4. Test locally with `pnpm dev`
5. Deploy with `pnpm deploy`
6. Trigger feed fetch and verify

### Priority 2: Verify a16z & Sequoia (Medium Impact)

**Feeds:** a16z Articles, Sequoia Capital Stories
**Estimated Time:** 45 minutes
**Impact:** +50-100 articles

**Steps:**
1. Manual curl tests with current selectors
2. Check for JavaScript rendering
3. Look for RSS feeds as alternative
4. Try alternative selectors if needed
5. Update feed configuration
6. Test and verify

### Priority 3: Investigate Greylock & Bessemer (Low Impact)

**Feeds:** Greylock, Bessemer
**Estimated Time:** 1 hour
**Impact:** +20-50 articles

**Steps:**
1. Test for JavaScript rendering with curl
2. Search for RSS/Atom feeds
3. Check robots.txt for feed URLs
4. If no RSS: test alternative selectors
5. If still failing: disable feeds or implement browser rendering

### Priority 4: Optimize USV (Low Impact)

**Feeds:** Union Square Ventures
**Estimated Time:** 15 minutes
**Impact:** +10-20 articles

**Steps:**
1. Check if there's actually more content on page
2. Test pagination
3. Try broader selector if needed

---

## Part 7: Files Modified

### Created Files

1. **[`scripts/add-vc-insights-feeds.sql`](../scripts/add-vc-insights-feeds.sql)**
   - Initial INSERT statements for 11 VC feeds
   - Used once, can be archived

2. **[`scripts/fix-vc-insights-selectors.sql`](../scripts/fix-vc-insights-selectors.sql)**
   - UPDATE statements fixing selectors and URLs
   - Used once, can be archived

3. **[`docs/2026-02-09-vc-feeds-deep-dive.md`](./2026-02-09-vc-feeds-deep-dive.md)** (this file)
   - Comprehensive documentation of work done
   - Reference for future troubleshooting

### Key Source Files to Modify

1. **[`src/services/feed/feed-service.ts`](../src/services/feed/feed-service.ts)**
   - **Location:** Article insertion logic
   - **Change Needed:** Add batch insert logic
   - **Priority:** High (fixes 2 feeds)

2. **[`src/server-functions/queues/feed-fetch-consumer.ts`](../src/server-functions/queues/feed-fetch-consumer.ts)**
   - **Optional:** Add per-feed logging for debugging
   - **Priority:** Low (helps troubleshooting)

---

## Part 8: Testing Commands Reference

```bash
# Database Queries
# ----------------

# Get VC feed status
npx wrangler d1 execute DB --remote --command \
  "SELECT name, url, isValid, errorCount, lastError,
   (SELECT COUNT(*) FROM Article WHERE feedId = Feed.id) as articleCount
   FROM Feed WHERE category = 'VC Insights' ORDER BY articleCount DESC"

# Get overall stats
npx wrangler d1 execute DB --remote --command \
  "SELECT COUNT(*) as total_feeds,
   SUM(CASE WHEN isValid = 1 THEN 1 ELSE 0 END) as valid_feeds,
   (SELECT COUNT(*) FROM Article) as total_articles,
   (SELECT COUNT(DISTINCT feedId) FROM Article) as feeds_with_articles
   FROM Feed"

# Get category breakdown
npx wrangler d1 execute DB --remote --command \
  "SELECT category, COUNT(*) as total,
   SUM(CASE WHEN (SELECT COUNT(*) FROM Article WHERE feedId = Feed.id) > 0 THEN 1 ELSE 0 END) as working,
   SUM((SELECT COUNT(*) FROM Article WHERE feedId = Feed.id)) as article_count
   FROM Feed GROUP BY category ORDER BY article_count DESC"

# Feed Operations
# ---------------

# Trigger feed fetch
pnpm trigger feed-fetch

# Watch logs in real-time
pnpm tail

# Deploy changes
pnpm deploy

# Selector Testing
# ----------------

# Test selector with curl (example: a16z)
curl -s "https://a16z.com/news-content/" | grep -o '<h6[^>]*>.*</h6>' | head -5

# Count elements matching selector
curl -s "https://example.com/page" | grep -o '<h2' | wc -l

# Check for RSS feeds
curl -s "https://example.com/" | grep -i "rss\|feed\|atom"

# Check robots.txt
curl -s "https://example.com/robots.txt"
```

---

## Part 9: Learnings & Recommendations

### Key Learnings

1. **Never Trust Initial Selectors**
   - Always verify with WebFetch or curl before adding feeds
   - CSS selectors from guessing are wrong ~80% of the time

2. **Test Incrementally**
   - Add feeds with `isActive = 0` first
   - Test individually before enabling in production
   - Saves time debugging issues later

3. **Batch Insert Limits Matter**
   - Cloudflare D1 has SQL variable limits
   - Design for batching from the start
   - Monitor for "too many variables" errors

4. **JavaScript Rendering is Common**
   - Many modern sites use client-side rendering
   - RSS feeds are more reliable than scraping
   - Browser rendering should be last resort (expensive)

5. **URLs Change**
   - Don't assume URL paths are permanent
   - Check site navigation to verify current paths
   - 404 errors are often URL changes, not site issues

### Recommendations for Future Feed Additions

1. **Pre-Addition Checklist**
   - [ ] Use WebFetch to analyze HTML structure
   - [ ] Test selector with curl + grep
   - [ ] Check for RSS/Atom feed alternative
   - [ ] Verify URL returns 200 (not 404/403)
   - [ ] Add feed with isActive = 0
   - [ ] Test manually before enabling

2. **Monitoring**
   - Set up alerts for feeds with errorCount > 3
   - Weekly review of feeds with 0 articles
   - Monthly audit of article counts per feed

3. **Documentation**
   - Document selector rationale in feed notes
   - Keep track of URLs that change
   - Maintain list of JavaScript-rendered sites

4. **Code Improvements**
   - Implement batch insert logic (Priority 1)
   - Add per-feed fetch endpoint for testing
   - Add selector validation before insertion
   - Consider adding RSS feed type support

---

## Conclusion

Today's work successfully added 11 VC Insights feeds, with 5 now fully operational and contributing 171 articles (38% increase in total articles). The remaining 6 feeds have clear paths to resolution:

- **2 feeds** need batch insert logic (high priority, easy fix)
- **2 feeds** need selector verification (medium priority, moderate effort)
- **2 feeds** need JavaScript rendering investigation (low priority, time-intensive)

The VC Insights category is now the **2nd highest article contributor** in the system, demonstrating the value of these feeds. With the fixes outlined above, we expect to reach 8-10 working VC feeds with 300-400 total VC articles.

**Next Session Goals:**
1. Implement batch insert logic in feed-service.ts
2. Fix Accel and Kleiner Perkins feeds
3. Verify a16z and Sequoia selectors
4. Document results

---

**Related Files:**
- [`scripts/add-vc-insights-feeds.sql`](../scripts/add-vc-insights-feeds.sql)
- [`scripts/fix-vc-insights-selectors.sql`](../scripts/fix-vc-insights-selectors.sql)
- [`src/services/feed/feed-service.ts`](../src/services/feed/feed-service.ts)
- [`src/server-functions/queues/feed-fetch-consumer.ts`](../src/server-functions/queues/feed-fetch-consumer.ts)

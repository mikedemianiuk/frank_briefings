# Briefings Architecture Guide

**AI-Powered RSS Digest System on Cloudflare Workers**

Version: 1.0
Last Updated: 2026-02-06

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Core Components](#core-components)
4. [Data Flow](#data-flow)
5. [Database Schema](#database-schema)
6. [Queue System](#queue-system)
7. [Error Handling & Triaging](#error-handling--triaging)
8. [Development Workflow](#development-workflow)
9. [Adding New Functionality](#adding-new-functionality)
10. [Troubleshooting Guide](#troubleshooting-guide)

---

## System Overview

### What It Does

Briefings is an automated news aggregation system that:
1. **Scrapes/fetches** articles from 22 RSS feeds and websites every 4 hours
2. **Summarizes** daily content using Google Gemini AI (10 AM UTC)
3. **Generates** weekly digest emails combining summaries (Sundays at 1 PM UTC)
4. **Delivers** via email (Resend) and archives to R2 storage

### Technology Stack

- **Runtime**: Cloudflare Workers (serverless V8 isolates)
- **Framework**: Hono (lightweight Express-like routing)
- **Database**: D1 (SQLite on Cloudflare)
- **Queue**: Cloudflare Queues (message passing)
- **Storage**: R2 (S3-compatible object storage)
- **Email**: Resend API
- **AI**: Google Gemini API
- **Language**: TypeScript

### Key Design Principles

1. **Queue-based**: Async processing prevents timeouts
2. **Idempotent**: Safe to retry operations
3. **Error-tolerant**: Single feed failure doesn't break system
4. **Stateless**: Each worker invocation is independent
5. **Cost-optimized**: Free tier compatible (D1, Queues, R2)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE WORKER                        │
│                     (src/index.ts)                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ HTTP Routes │  │ Cron Triggers│  │Queue Consumers│     │
│  │  (Hono)     │  │   (4 jobs)   │  │   (4 queues)  │     │
│  └─────────────┘  └──────────────┘  └──────────────┘      │
│         │                │                   │              │
└─────────┼────────────────┼───────────────────┼──────────────┘
          │                │                   │
          ▼                ▼                   ▼
    ┌─────────┐      ┌─────────┐        ┌─────────┐
    │   D1    │      │ Queues  │        │   R2    │
    │Database │      │ System  │        │ Storage │
    └─────────┘      └─────────┘        └─────────┘
          │                │                   │
          └────────────────┴───────────────────┘
                           │
                    ┌──────▼──────┐
                    │  External   │
                    │  Services   │
                    │             │
                    │ • Gemini AI │
                    │ • Resend    │
                    └─────────────┘
```

---

## Core Components

### 1. Entry Point: `src/index.ts`

**Purpose**: Unified worker entry with three handlers

```typescript
export default {
  fetch,      // HTTP requests (Hono routes)
  scheduled,  // Cron jobs (4 schedules)
  queue       // Queue messages (4 queues)
}
```

**Responsibilities**:
- Route HTTP requests to Hono app
- Dispatch cron jobs by expression
- Route queue messages by queue name

**Key Code Pattern**:
```typescript
// Cron dispatcher
const cronHandlers: Record<string, CronHandler> = {
  '0 */4 * * *': feedFetchCron,      // Every 4 hours
  '0 10 * * *': dailySummaryCron,    // 10 AM UTC
  // ...
};

async function scheduled(event: ScheduledEvent, env: Env) {
  const handler = cronHandlers[event.cron];
  await handler(event, env);
}
```

### 2. HTTP Layer: `src/server-functions/http/`

**Structure**:
```
http/
├── middleware.ts       # Auth, error handling
├── routes.ts           # Route definitions
└── handlers/
    ├── health.ts       # GET /api/health
    ├── feed-fetch.ts   # POST /api/run/feed-fetch
    ├── daily-summary.ts
    └── weekly-summary.ts
```

**Authentication Pattern**:
```typescript
// middleware.ts
export const requireApiKey = createMiddleware(async (c, next) => {
  const apiKey = c.req.header('X-API-Key');
  const expectedKey = c.env.API_KEY;

  if (apiKey !== expectedKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
});
```

**Route Registration**:
```typescript
// routes.ts
import { requireApiKey } from './middleware';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', healthHandler);
app.post('/api/run/feed-fetch', requireApiKey, feedFetchHandler);
```

### 3. Queue Consumers: `src/server-functions/queues/`

**Four Queues**:

| Queue | Purpose | Batch Size | Timeout |
|-------|---------|------------|---------|
| `briefings-feed-fetch` | Fetch/scrape feeds | 10 | 30s |
| `briefings-daily-summary-initiator` | Find unprocessed articles | 1 | 30s |
| `briefings-daily-summary-processor` | Generate AI summaries | 5 | 60s |
| `briefings-weekly-digest` | Create & email digest | 1 | 60s |

**Consumer Pattern**:
```typescript
// queues/feed-fetch-consumer.ts
export async function queue(
  batch: MessageBatch<FeedFetchMessage>,
  env: Env
): Promise<void> {
  await setupDb(env);

  const results = await Promise.allSettled(
    batch.messages.map(msg => processMessage(msg, env))
  );

  // Acknowledge successful messages
  batch.messages.forEach((msg, i) => {
    if (results[i].status === 'fulfilled') {
      msg.ack();
    }
    // Failed messages auto-retry
  });
}
```

**Key Insight**: Queues provide durability. If a worker crashes, messages retry automatically.

### 4. Services Layer: `src/services/`

**Core Services**:

```
services/
├── feed/
│   ├── feed-service.ts          # Main feed operations
│   ├── rss-parser-workers.ts    # RSS parsing
│   └── adapters/
│       ├── feed-adapter.ts      # Interface
│       ├── rss-adapter.ts       # RSS implementation
│       └── scraper-adapter.ts   # Web scraping
├── summarization/
│   └── summarization-service.ts # AI summarization
└── interfaces.ts                # Service contracts
```

**Adapter Pattern (Feed Fetching)**:

```typescript
// services/feed/feed-service.ts
async fetchFeed(feed: Feed): Promise<ParsedFeedItem[]> {
  let adapter: IFeedAdapter;

  if (feed.type === 'scrape') {
    adapter = new ScraperAdapter();
  } else {
    adapter = new RssAdapter();
  }

  return await adapter.fetchArticles(feed.url, feed.selector);
}
```

**Why This Pattern?**
- **Extensibility**: Add new feed types (JSON API, GraphQL, etc.)
- **Testability**: Mock adapters easily
- **Separation**: RSS and scraping logic isolated

### 5. Database Layer: `src/db/`

**Structure**:
```
db/
├── index.ts        # Kysely instance creation
├── types.ts        # Table schemas (TypeScript)
├── helpers.ts      # Conversion utilities
└── schema.sql      # (Reference only)
```

**Type-Safe Queries with Kysely**:

```typescript
// Read with type safety
const feeds = await db
  .selectFrom('Feed')
  .selectAll()
  .where('isActive', '=', 1)
  .execute(); // Type: Feed[]

// Insert with validation
const newFeed: NewFeed = {
  name: 'Example',
  url: 'https://example.com',
  type: 'rss',
  // TypeScript ensures all required fields present
};

await db.insertInto('Feed').values(newFeed).execute();
```

**Database Initialization**:
```typescript
// CRITICAL: Must call before any DB operation
await setupDb(env);
```

### 6. AI Integration: `src/lib/gemini.ts`

**Gemini Client Wrapper**:

```typescript
export class GeminiClient {
  async generateContent(prompt: string): Promise<string> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey
        },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );

    // Extract text from response
    return response.candidates[0].content.parts[0].text;
  }
}
```

**Model Selection Strategy**:
- **Daily Summaries**: `gemini-3-flash-preview` (fast, cheap)
- **Weekly Digests**: `gemini-3-pro-preview` (comprehensive)

---

## Data Flow

### Flow 1: Article Scraping (Every 4 Hours)

```
Cron (0 */4 * * *)
  │
  ├─> feedFetchCron() [src/server-functions/crons/feed-fetch.ts]
  │     │
  │     ├─> Get active feeds from D1
  │     ├─> Queue.send() → FEED_FETCH_QUEUE (1 msg per feed)
  │     └─> Return (no waiting)
  │
  └─> Queue Consumer [feed-fetch-consumer.ts]
        │
        ├─> For each message:
        │     ├─> Get/create Feed record
        │     ├─> FeedService.fetchFeed(feed)
        │     │     └─> Adapter pattern (RSS or Scrape)
        │     ├─> Parse articles
        │     ├─> De-duplicate (check existing URLs)
        │     ├─> Insert new articles → D1
        │     └─> Update feed.lastFetchedAt
        │
        └─> Acknowledge messages
```

**Error Handling**:
- Feed fetch fails → `lastError` updated, `errorCount++`
- Individual article fails → Logged, others continue
- No new articles → Not an error, logged as info

### Flow 2: Daily Summary Generation (10 AM UTC)

```
Cron (0 10 * * *)
  │
  ├─> dailySummaryCron()
  │     │
  │     └─> Queue.send() → DAILY_SUMMARY_INITIATOR_QUEUE
  │
  └─> Initiator Consumer [daily-summary-initiator.ts]
        │
        ├─> Query unprocessed articles (processed=0)
        ├─> Group by feed
        ├─> Queue.send() → DAILY_SUMMARY_PROCESSOR_QUEUE
        │     (1 message per feed with articles)
        └─> Mark articles as processed

Processor Consumer [daily-summary-processor.ts]
  │
  ├─> Fetch articles for feed/date
  ├─> Build prompt with article details
  ├─> GeminiClient.generateSummary()
  ├─> Parse AI response
  ├─> Save to DailySummary table
  └─> Link articles → ArticleSummaryRelation
```

**Why Two-Stage?**
1. **Initiator**: Fast, scans database
2. **Processor**: Slow, calls external AI API
3. **Parallel**: Multiple feeds summarized concurrently

### Flow 3: Weekly Digest (Sundays at 1 PM UTC)

```
Cron (0 13 * * Sun)
  │
  ├─> weeklyDigestCron()
  │     │
  │     └─> Queue.send() → WEEKLY_DIGEST_QUEUE
  │
  └─> Digest Consumer [weekly-digest-consumer.ts]
        │
        ├─> Check for existing WeeklySummary (avoid duplicates)
        ├─> Fetch DailySummary records for past 7 days
        ├─> R2.fetchDigestContext() (last 4 weeks for novelty)
        ├─> GeminiClient.generateWeeklyRecap()
        ├─> Parse metadata (title, topics)
        ├─> Parse sections (recap, quick hits, sign-off)
        ├─> Save to D1 → WeeklySummary
        ├─> Save to R2 → digests/2026-W05.json
        └─> ResendEmail.send()
              └─> Update WeeklySummary.sentAt
```

**Key Features**:
- **Context-aware**: Uses past 4 digests to avoid repetition
- **Dual storage**: D1 (queryable) + R2 (long-term archive)
- **Email formatting**: Markdown → HTML with custom styling

---

## Database Schema

### Tables Overview

```
Feed (22 rows)
  ↓ (1:N)
Article (394 rows)
  ↓ (N:M via ArticleSummaryRelation)
DailySummary (0 rows currently)
  ↓ (N:M via DailyWeeklySummaryRelation)
WeeklySummary (0 rows currently)
```

### Feed Table

```sql
CREATE TABLE Feed (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'rss',  -- 'rss' | 'scrape'
  selector TEXT,                      -- CSS selector for scraping
  category TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  isValid INTEGER NOT NULL DEFAULT 1,
  validationError TEXT,
  lastFetchedAt INTEGER,              -- Unix ms
  lastError TEXT,
  errorCount INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER,
  updatedAt INTEGER
);
```

**Key Fields**:
- `type`: Determines adapter (RSS vs scrape)
- `selector`: Used by ScraperAdapter for HTML parsing
- `isActive`: 0 = skip in cron jobs
- `isValid`: 0 = failed validation, will retry
- `lastError`: Most recent error message (debugging)
- `errorCount`: Increments on failure, resets on success

### Article Table

```sql
CREATE TABLE Article (
  id TEXT PRIMARY KEY,
  feedId TEXT NOT NULL REFERENCES Feed(id),
  title TEXT NOT NULL,
  link TEXT NOT NULL UNIQUE,
  content TEXT,
  contentSnippet TEXT,
  creator TEXT,
  isoDate TEXT,
  pubDate INTEGER,                    -- Unix ms
  processed INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER,
  updatedAt INTEGER
);
```

**Key Fields**:
- `link`: Unique constraint prevents duplicates
- `processed`: 0 = needs summarization, 1 = done
- `pubDate`: Used for date-range queries

### DailySummary Table

```sql
CREATE TABLE DailySummary (
  id TEXT PRIMARY KEY,
  feedId TEXT NOT NULL REFERENCES Feed(id),
  summaryDate INTEGER NOT NULL,       -- Unix ms (start of day)
  summaryContent TEXT NOT NULL,       -- AI-generated text
  structuredContent TEXT,             -- JSON (future use)
  schemaVersion TEXT,
  sentiment REAL,                     -- Future: -1 to 1
  topicsList TEXT,                    -- Comma-separated
  entityList TEXT,                    -- Future: NER
  articleCount INTEGER,
  createdAt INTEGER,
  updatedAt INTEGER,
  UNIQUE(feedId, summaryDate)
);
```

**Key Pattern**: One summary per feed per day

### WeeklySummary Table

```sql
CREATE TABLE WeeklySummary (
  id TEXT PRIMARY KEY,
  weekStartDate INTEGER NOT NULL,
  weekEndDate INTEGER NOT NULL,
  title TEXT NOT NULL,                -- Email subject
  recapContent TEXT NOT NULL,         -- Main narrative
  belowTheFoldContent TEXT,           -- Extended section
  soWhatContent TEXT,                 -- Analysis
  topics TEXT,                        -- JSON array
  sentAt INTEGER,                     -- NULL = not sent
  createdAt INTEGER,
  updatedAt INTEGER,
  UNIQUE(weekStartDate, weekEndDate)
);
```

**Key Field**: `sentAt` tracks delivery (prevents duplicates)

### Helper Functions

```typescript
// db/helpers.ts

// Convert JS Date → Unix ms
export function toTimestamp(date: Date | null): number | null {
  return date ? date.getTime() : null;
}

// Convert Unix ms → JS Date
export function fromTimestamp(ts: number | null): Date | null {
  return ts ? new Date(ts) : null;
}

// Convert boolean → SQLite integer
export function toBool(value: boolean): number {
  return value ? 1 : 0;
}

// Convert SQLite integer → boolean
export function fromBool(value: number): boolean {
  return value === 1;
}
```

---

## Queue System

### How Cloudflare Queues Work

**Push Model**:
```typescript
await env.FEED_FETCH_QUEUE.send({
  feedUrl: 'https://example.com',
  feedName: 'Example Feed',
  feedId: 'abc123',
  requestId: crypto.randomUUID()
});
```

**Batch Processing**:
```typescript
export async function queue(
  batch: MessageBatch<FeedFetchMessage>,
  env: Env
) {
  // batch.messages = array of up to 10 messages
  // Process in parallel for performance
  const results = await Promise.allSettled(
    batch.messages.map(msg => processMessage(msg, env))
  );

  // Acknowledge or retry
  batch.messages.forEach((msg, i) => {
    if (results[i].status === 'fulfilled') {
      msg.ack();  // Remove from queue
    }
    // If not acked, auto-retries after visibility timeout
  });
}
```

### Retry Behavior

**Automatic Retries**:
- Message not acknowledged → Redelivered after timeout
- Max retries: 3 (default)
- Dead letter queue: Not configured (optional)

**Idempotency Pattern**:
```typescript
// Check if already processed
const existing = await db
  .selectFrom('Feed')
  .where('url', '=', message.feedUrl)
  .executeTakeFirst();

if (existing && existing.lastFetchedAt > recentThreshold) {
  // Skip, already processed recently
  message.ack();
  return;
}
```

### Queue Configuration

**In wrangler.toml**:
```toml
[[queues.consumers]]
queue = "briefings-feed-fetch"
max_batch_size = 10     # Process up to 10 messages at once
max_batch_timeout = 30  # Wait 30s to fill batch
```

**Tuning Guidelines**:
- **High throughput**: Increase `max_batch_size`
- **Fast processing**: Decrease `max_batch_timeout`
- **Long operations**: Increase consumer timeout (60s)

---

## Error Handling & Triaging

### Error Types

#### 1. Feed Fetch Errors

**Symptoms**:
- `lastError` populated in Feed table
- `errorCount` incremented
- No new articles

**Common Causes**:
| Error | Cause | Fix |
|-------|-------|-----|
| `HTTP 404` | Wrong URL | Update `Feed.url` |
| `HTTP 403` | Access blocked | Check User-Agent, use proxy |
| `HTTP 429` | Rate limited | Disable feed (`isActive=0`), add delay |
| `Selector not found` | Wrong CSS selector | Update `Feed.selector` |
| `Failed to parse RSS` | Invalid XML | Check feed manually, switch to scrape |

**Diagnostic Query**:
```sql
SELECT name, lastError, errorCount, lastFetchedAt
FROM Feed
WHERE lastError IS NOT NULL
ORDER BY errorCount DESC, updatedAt DESC;
```

**Fix Pattern**:
```sql
-- Update URL
UPDATE Feed SET
  url = 'https://correct-url.com',
  isValid = 1,
  lastError = NULL,
  errorCount = 0
WHERE name = 'Feed Name';

-- Update selector
UPDATE Feed SET
  selector = 'article h2, h3',
  isValid = 1,
  lastError = NULL
WHERE name = 'Feed Name';
```

#### 2. Database Errors

**Common Issues**:

**`SQLITE_ERROR: too many SQL variables`**
- **Cause**: Inserting too many articles in one batch
- **Fix**: Limit results in scraper (use more specific selector)
```typescript
// ScraperAdapter: Limit results
const items = elements.slice(0, 50); // Max 50 items
```

**`D1_ERROR: database locked`**
- **Cause**: Concurrent writes (rare with D1)
- **Solution**: Retry with exponential backoff

**`Foreign key constraint failed`**
- **Cause**: Orphaned relationship
- **Fix**: Ensure parent record exists before inserting child

#### 3. AI Generation Errors

**Symptoms**:
- DailySummary not created
- `Failed to generate summary` in logs

**Common Causes**:
| Error | Cause | Fix |
|-------|-------|-----|
| `API key invalid` | GEMINI_API_KEY not set | `npx wrangler secret put GEMINI_API_KEY` |
| `Quota exceeded` | Free tier limit hit | Wait 24h or upgrade |
| `Content too long` | Too many articles | Reduce articles per summary |
| `Content filtered` | Inappropriate content | Review article content |

**Check API Key**:
```bash
npx wrangler secret list | grep GEMINI_API_KEY
```

**Test Manually**:
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: YOUR_KEY" \
  -d '{"contents":[{"parts":[{"text":"Summarize: Article title"}]}]}' \
  https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent
```

#### 4. Email Delivery Errors

**Symptoms**:
- WeeklySummary created but `sentAt` is NULL
- Email not received

**Diagnostic Steps**:

1. **Check Secrets**:
```bash
npx wrangler secret list | grep RESEND_API_KEY
```

2. **Check Environment Variables**:
```bash
grep EMAIL_ wrangler.toml
```

3. **Check Resend Dashboard**:
   - Go to resend.com → Logs
   - Find recent sends
   - Check delivery status

4. **Common Fixes**:
```bash
# Re-set API key
echo "re_YOUR_KEY" | npx wrangler secret put RESEND_API_KEY

# Update email addresses
# Edit wrangler.toml
EMAIL_FROM = "verified@yourdomain.com"
EMAIL_TO = "your@email.com"

# Deploy
npx wrangler deploy
```

### Monitoring & Logs

#### Real-Time Logs

```bash
# Tail production logs
pnpm tail

# Filter for errors
pnpm tail | grep ERROR

# Filter for specific feed
pnpm tail | grep "Hacker News"
```

#### Database Health Checks

```bash
# Article growth rate
npx wrangler d1 execute DB --remote --command="
  SELECT
    DATE(createdAt/1000, 'unixepoch') as date,
    COUNT(*) as articles
  FROM Article
  GROUP BY date
  ORDER BY date DESC
  LIMIT 7
"

# Feed success rate
npx wrangler d1 execute DB --remote --command="
  SELECT
    CASE WHEN lastFetchedAt IS NOT NULL THEN 'Working' ELSE 'Failed' END as status,
    COUNT(*) as count
  FROM Feed
  WHERE type='scrape' AND isActive=1
  GROUP BY status
"
```

#### Queue Status

```bash
# List queues
npx wrangler queues list

# Queue details (if supported)
npx wrangler queues describe briefings-feed-fetch
```

---

## Development Workflow

### Local Development

**Start Dev Server**:
```bash
pnpm dev
```

This connects to **remote** resources (D1, Queues, R2) for testing.

**Why Remote?**
- D1 local mode has limitations
- Queues require remote connection
- Gemini/Resend APIs are external

### Testing Flow

#### 1. Test Feed Fetch

```bash
# Trigger via API
pnpm trigger feed-fetch

# Check results
npx wrangler d1 execute DB --remote --command="
  SELECT name, lastFetchedAt IS NOT NULL as working
  FROM Feed
  WHERE type='scrape'
  ORDER BY name
"
```

#### 2. Test Daily Summary

```bash
# Generate for specific date
pnpm trigger daily-summary 2026-02-06 --force

# Check results (wait 60s)
npx wrangler d1 execute DB --remote --command="
  SELECT COUNT(*) as count FROM DailySummary
"
```

#### 3. Test Weekly Digest

```bash
# Generate for specific week
pnpm trigger weekly-summary 2026-02-09

# Check email inbox
# Check R2 storage
npx wrangler r2 object get briefings-md-output digests/2026-W06.json
```

### Deployment

```bash
# Deploy to production
pnpm deploy

# Verify deployment
curl https://briefings.YOUR-SUBDOMAIN.workers.dev/api/health
```

### Database Migrations

```bash
# Create migration file
echo "ALTER TABLE Feed ADD COLUMN priority INTEGER DEFAULT 0;" > migrations/0003_add_priority.sql

# Apply migration
pnpm db:migrate

# Verify
npx wrangler d1 execute DB --remote --command="PRAGMA table_info(Feed)"
```

---

## Adding New Functionality

### Example 1: Add a New Feed Type (JSON API)

**1. Create Adapter**:

```typescript
// src/services/feed/adapters/json-adapter.ts
import type { IFeedAdapter } from './feed-adapter.js';
import type { ParsedFeedItem } from '../../interfaces.js';

export class JsonApiAdapter implements IFeedAdapter {
  async fetchArticles(url: string): Promise<ParsedFeedItem[]> {
    const response = await fetch(url);
    const data = await response.json();

    return data.articles.map(article => ({
      title: article.headline,
      link: article.url,
      content: article.body,
      pubDate: article.publishedAt
    }));
  }
}
```

**2. Update Feed Service**:

```typescript
// src/services/feed/feed-service.ts
import { JsonApiAdapter } from './adapters/json-adapter.js';

async fetchFeed(feed: Feed): Promise<ParsedFeedItem[]> {
  let adapter: IFeedAdapter;

  if (feed.type === 'scrape') {
    adapter = new ScraperAdapter();
  } else if (feed.type === 'json') {
    adapter = new JsonApiAdapter();
  } else {
    adapter = new RssAdapter();
  }

  return await adapter.fetchArticles(feed.url, feed.selector);
}
```

**3. Add Feed**:

```sql
INSERT INTO Feed (id, name, url, type, category, isActive, isValid, errorCount, createdAt, updatedAt)
VALUES (
  'json-feed-1',
  'JSON API Feed',
  'https://api.example.com/articles',
  'json',
  'Tech',
  1, 1, 0,
  1234567890000,
  1234567890000
);
```

### Example 2: Add Sentiment Analysis

**1. Extend Database Schema**:

```sql
-- migrations/0003_add_sentiment.sql
ALTER TABLE DailySummary ADD COLUMN sentimentScore REAL;
ALTER TABLE DailySummary ADD COLUMN sentimentLabel TEXT;
```

**2. Add Sentiment Service**:

```typescript
// src/services/sentiment/sentiment-service.ts
export class SentimentService {
  async analyze(text: string): Promise<{score: number, label: string}> {
    // Call Gemini with sentiment prompt
    const prompt = `Analyze sentiment of: ${text}. Return JSON: {"score": -1 to 1, "label": "positive|negative|neutral"}`;

    const response = await gemini.generateContent(prompt);
    return JSON.parse(response);
  }
}
```

**3. Integrate into Summarization**:

```typescript
// src/services/summarization/summarization-service.ts
async generateDailySummary(articles, feedName, date, env, db) {
  const summaryContent = await this.gemini.generateSummary(prompt);

  // NEW: Analyze sentiment
  const sentiment = await this.sentimentService.analyze(summaryContent);

  const summary: NewDailySummary = {
    // ... existing fields
    sentimentScore: sentiment.score,
    sentimentLabel: sentiment.label
  };

  return await db.insertInto('DailySummary').values(summary).execute();
}
```

### Example 3: Add Slack Notifications

**1. Add Slack Webhook Secret**:

```bash
echo "https://hooks.slack.com/services/YOUR/WEBHOOK" | npx wrangler secret put SLACK_WEBHOOK_URL
```

**2. Create Slack Service**:

```typescript
// src/lib/slack.ts
export class SlackNotifier {
  constructor(private webhookUrl: string) {}

  async notify(message: string): Promise<void> {
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: message,
        username: 'Briefings Bot',
        icon_emoji: ':newspaper:'
      })
    });
  }
}
```

**3. Integrate**:

```typescript
// src/server-functions/queues/weekly-digest-consumer.ts
async function processWeeklyDigest(message, env) {
  // ... existing code

  const digest = await generateDigest();

  // NEW: Slack notification
  if (env.SLACK_WEBHOOK_URL) {
    const slack = new SlackNotifier(env.SLACK_WEBHOOK_URL);
    await slack.notify(`Weekly digest generated: ${digest.title}`);
  }

  // ... send email
}
```

---

## Troubleshooting Guide

### Problem: No Articles Being Scraped

**Diagnostic Steps**:

1. Check feed status:
```bash
npx wrangler d1 execute DB --remote --command="
  SELECT name, isActive, lastFetchedAt, lastError
  FROM Feed
  WHERE type='scrape'
  ORDER BY errorCount DESC
"
```

2. Check cron execution:
```bash
pnpm tail | grep "feedFetchCron"
```

3. Test single feed manually:
```bash
curl -X POST \
  -H "X-API-Key: YOUR_KEY" \
  https://YOUR-WORKER.workers.dev/api/run/feed-fetch
```

**Common Fixes**:
- Feed marked inactive: `UPDATE Feed SET isActive=1`
- Selector wrong: Update `Feed.selector`
- URL 404: Update `Feed.url`

### Problem: Daily Summaries Not Generating

**Diagnostic Steps**:

1. Check Gemini API key:
```bash
npx wrangler secret list | grep GEMINI
```

2. Check for articles to summarize:
```bash
npx wrangler d1 execute DB --remote --command="
  SELECT COUNT(*) as unprocessed
  FROM Article
  WHERE processed=0
"
```

3. Check queue logs:
```bash
pnpm tail | grep "daily-summary"
```

**Common Fixes**:
- No API key: `echo "KEY" | npx wrangler secret put GEMINI_API_KEY`
- No articles: Trigger feed fetch first
- Quota exceeded: Wait 24h or upgrade Gemini

### Problem: Emails Not Sending

**Diagnostic Steps**:

1. Check Resend config:
```bash
npx wrangler secret list | grep RESEND
grep EMAIL_ wrangler.toml
```

2. Check WeeklySummary table:
```bash
npx wrangler d1 execute DB --remote --command="
  SELECT id, title, sentAt
  FROM WeeklySummary
  ORDER BY createdAt DESC
  LIMIT 1
"
```

3. Check Resend dashboard:
   - Go to resend.com/emails
   - Find recent sends
   - Check status (delivered/bounced)

**Common Fixes**:
- API key missing: `echo "KEY" | npx wrangler secret put RESEND_API_KEY`
- Wrong FROM address: Update `EMAIL_FROM` in wrangler.toml
- Email not verified: Add domain to Resend, verify DNS

### Problem: "Database Locked" Errors

**Cause**: Concurrent writes to D1

**Fix**: Add retry logic
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, i)));
    }
  }
  throw new Error('Max retries exceeded');
}

// Usage
await withRetry(() =>
  db.insertInto('Article').values(article).execute()
);
```

---

## Best Practices

### 1. Always Use Type Safety

```typescript
// ❌ Bad
const feed = await db.selectFrom('Feed').selectAll().execute();
// Type: unknown[]

// ✅ Good
const feeds: Feed[] = await db.selectFrom('Feed').selectAll().execute();
// Type: Feed[] (compile-time checking)
```

### 2. Handle Errors Gracefully

```typescript
// ❌ Bad
const articles = await feedService.fetchFeed(feed);
// Throws on error, breaks entire batch

// ✅ Good
try {
  const articles = await feedService.fetchFeed(feed);
  await processFeed(articles);
} catch (error) {
  logger.error('Feed fetch failed', error, { feedName: feed.name });
  await updateFeedError(feed.id, error.message);
  // Continue processing other feeds
}
```

### 3. Use Structured Logging

```typescript
// ❌ Bad
console.log('Feed fetch failed');

// ✅ Good
logger.error('Feed fetch failed', error, {
  feedId: feed.id,
  feedName: feed.name,
  feedUrl: feed.url,
  errorCode: error.code,
  duration: Date.now() - startTime
});
```

### 4. Validate External Input

```typescript
// ❌ Bad
const date = request.body.date;
const summary = await generateSummary(date);

// ✅ Good
const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  force: z.boolean().optional()
});

const validated = schema.parse(request.body);
const summary = await generateSummary(validated.date);
```

### 5. Make Operations Idempotent

```typescript
// ✅ Good: Safe to call multiple times
async function ensureFeedExists(url: string): Promise<Feed> {
  // Check if exists
  const existing = await db
    .selectFrom('Feed')
    .where('url', '=', url)
    .executeTakeFirst();

  if (existing) return existing;

  // Create if not exists
  return await db.insertInto('Feed').values({...}).execute();
}
```

---

## Performance Optimization

### Database

**Index Key Columns**:
```sql
CREATE INDEX idx_article_feedid ON Article(feedId);
CREATE INDEX idx_article_pubdate ON Article(pubDate);
CREATE INDEX idx_article_processed ON Article(processed);
```

**Limit Query Results**:
```typescript
// ❌ Bad
const articles = await db.selectFrom('Article').selectAll().execute();

// ✅ Good
const articles = await db
  .selectFrom('Article')
  .selectAll()
  .limit(100)
  .execute();
```

### Queues

**Batch Processing**:
```typescript
// Process in parallel for better throughput
const results = await Promise.allSettled(
  batch.messages.map(msg => processMessage(msg))
);
```

**Adjust Batch Size**:
- Small messages: Increase `max_batch_size`
- Large messages: Decrease to avoid timeout

### AI Calls

**Use Appropriate Model**:
- Quick tasks: `gemini-1.5-flash` (cheap, fast)
- Complex analysis: `gemini-1.5-pro` (expensive, accurate)

**Limit Input Size**:
```typescript
// Truncate long content
const truncated = content.slice(0, 5000);
```

---

## Security Considerations

### 1. API Key Management

**DO**:
- Use Cloudflare Secrets for sensitive data
- Rotate keys periodically
- Use different keys for dev/prod

**DON'T**:
- Commit keys to git
- Log keys in error messages
- Share keys in documentation

### 2. Input Validation

**Always Validate**:
- User-provided URLs (SSRF attacks)
- SQL query parameters (injection)
- Webhook payloads (tampering)

```typescript
// ✅ Good
const url = new URL(userInput);
if (url.protocol !== 'https:') {
  throw new Error('Only HTTPS allowed');
}
```

### 3. Rate Limiting

**Protect Your APIs**:
```typescript
// src/server-functions/http/middleware.ts
const rateLimiter = new Map<string, number>();

export const rateLimit = createMiddleware(async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  const count = rateLimiter.get(ip) || 0;

  if (count > 100) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  rateLimiter.set(ip, count + 1);
  await next();
});
```

---

## Resources

### Documentation

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [D1 Database](https://developers.cloudflare.com/d1/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
- [Hono Framework](https://hono.dev/)
- [Kysely SQL Builder](https://kysely.dev/)
- [Google Gemini API](https://ai.google.dev/docs)
- [Resend Email API](https://resend.com/docs)

### Useful Commands

```bash
# Development
pnpm dev                    # Start dev server
pnpm tail                   # View logs
pnpm typecheck              # Check TypeScript

# Database
pnpm db:migrate             # Run migrations
pnpm sync:feeds             # Sync feeds from YAML

# Triggers
pnpm trigger feed-fetch     # Manual feed fetch
pnpm trigger daily-summary 2026-02-06 --force
pnpm trigger weekly-summary 2026-02-09

# Deployment
pnpm deploy                 # Deploy to production

# Secrets
npx wrangler secret list    # List secrets
echo "value" | npx wrangler secret put KEY_NAME
npx wrangler secret delete KEY_NAME
```

### Helper Scripts

```bash
# View summaries
bash scripts/view-summaries.sh

# Add feed interactively
bash scripts/add-scrape-feed.sh

# Setup email
bash scripts/setup-email.sh
```

---

## Appendix: File Structure

```
mikes-briefings/
├── src/
│   ├── index.ts                    # Worker entry point
│   ├── types/
│   │   └── env.d.ts                # Cloudflare bindings
│   ├── db/
│   │   ├── index.ts                # Kysely setup
│   │   ├── types.ts                # Table schemas
│   │   └── helpers.ts              # Utilities
│   ├── lib/
│   │   ├── gemini.ts               # AI client
│   │   ├── email.ts                # Resend client
│   │   ├── r2.ts                   # Storage client
│   │   ├── logger.ts               # Logging
│   │   ├── errors.ts               # Error types
│   │   └── constants.ts            # Config
│   ├── services/
│   │   ├── feed/
│   │   │   ├── feed-service.ts
│   │   │   ├── rss-parser-workers.ts
│   │   │   └── adapters/
│   │   │       ├── feed-adapter.ts
│   │   │       ├── rss-adapter.ts
│   │   │       └── scraper-adapter.ts
│   │   ├── summarization/
│   │   │   └── summarization-service.ts
│   │   ├── interfaces.ts
│   │   └── tasks.ts
│   └── server-functions/
│       ├── http/
│       │   ├── middleware.ts
│       │   ├── routes.ts
│       │   └── handlers/
│       ├── crons/
│       │   ├── feed-fetch.ts
│       │   ├── daily-summary.ts
│       │   └── weekly-digest.ts
│       ├── queues/
│       │   ├── feed-fetch-consumer.ts
│       │   ├── daily-summary-initiator.ts
│       │   ├── daily-summary-processor.ts
│       │   └── weekly-digest-consumer.ts
│       └── utils/
│           └── queue-dispatcher.ts
├── config/
│   ├── feeds.yaml                  # Feed definitions
│   └── scrape-feeds.yaml           # Scrape feed list
├── migrations/
│   ├── 0001_initial_schema.sql
│   └── 0002_add_feed_type.sql
├── scripts/
│   ├── trigger.ts                  # Manual triggers
│   ├── add-scrape-feed.sh          # Interactive add
│   ├── setup-email.sh              # Email config
│   ├── view-summaries.sh           # View DB data
│   ├── import-scrape-feeds.sh      # Bulk import
│   ├── fix-selectors.sql           # Selector fixes
│   └── import-feeds.sql            # SQL imports
├── wrangler.toml                   # Worker config
├── package.json                    # Dependencies
├── tsconfig.json                   # TypeScript config
├── CLAUDE.md                       # Claude instructions
└── ARCHITECTURE.md                 # This file
```

---

**End of Architecture Guide**

For questions or issues, refer to specific sections above or check the inline code comments.

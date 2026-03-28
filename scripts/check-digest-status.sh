#!/bin/bash
# Check status of weekly digest
# Run with: bash scripts/check-digest-status.sh

cd "$(dirname "$0")/.."

echo "📊 Briefings Status Check"
echo "========================="
echo ""

echo "📰 Daily Summaries:"
npx wrangler d1 execute DB --remote --command="
SELECT
  date(summaryDate/1000, 'unixepoch') as date,
  COUNT(*) as count
FROM DailySummary
GROUP BY date
ORDER BY date DESC
LIMIT 7
"

echo ""
echo "📧 Weekly Digests:"
npx wrangler d1 execute DB --remote --command="
SELECT
  id,
  title,
  datetime(weekStartDate/1000, 'unixepoch') as week_start,
  datetime(weekEndDate/1000, 'unixepoch') as week_end,
  datetime(sentAt/1000, 'unixepoch') as sent_at,
  CASE WHEN sentAt IS NOT NULL THEN '✅ Sent' ELSE '⏳ Not Sent' END as status
FROM WeeklySummary
ORDER BY createdAt DESC
LIMIT 3
"

echo ""
echo "🔑 Secrets Configured:"
npx wrangler secret list

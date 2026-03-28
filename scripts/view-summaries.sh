#!/bin/bash
# View daily summaries
# Run with: bash scripts/view-summaries.sh [date]

cd "$(dirname "$0")/.."

DATE=${1:-"all"}

echo "📰 Daily Summaries Viewer"
echo "=========================="
echo ""

if [ "$DATE" = "all" ]; then
    echo "Showing all daily summaries:"
    echo ""
    npx wrangler d1 execute DB --remote --command="
        SELECT
            datetime(summaryDate/1000, 'unixepoch') as date,
            articleCount as articles,
            LENGTH(summaryContent) as chars
        FROM DailySummary
        ORDER BY summaryDate DESC
        LIMIT 10
    "
else
    echo "Showing summary for $DATE:"
    echo ""
    npx wrangler d1 execute DB --remote --command="
        SELECT
            datetime(summaryDate/1000, 'unixepoch') as date,
            summaryContent as summary
        FROM DailySummary
        WHERE date(summaryDate/1000, 'unixepoch') = '$DATE'
        LIMIT 1
    "
fi

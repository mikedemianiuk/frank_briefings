#!/bin/bash
# Bulk import scrape feeds from config/scrape-feeds.yaml
# Run with: bash scripts/import-scrape-feeds.sh

set -e

cd "$(dirname "$0")/.."

echo "🔍 Bulk Scrape Feed Importer"
echo "============================"
echo ""

# Check if config file exists
if [ ! -f "config/scrape-feeds.yaml" ]; then
    echo "❌ Config file not found: config/scrape-feeds.yaml"
    exit 1
fi

# Count feeds
FEED_COUNT=$(grep -c "^  - name:" config/scrape-feeds.yaml || echo "0")

echo "📋 Found $FEED_COUNT feeds in config/scrape-feeds.yaml"
echo ""
echo "This will add all feeds to your remote database."
read -p "Continue? (y/n): " confirm

if [ "$confirm" != "y" ]; then
    echo "❌ Cancelled"
    exit 0
fi

echo ""
echo "🚀 Importing feeds..."
echo ""

# Use tsx to run the TypeScript import script
tsx scripts/import-scrape-feeds.ts

echo ""
echo "✅ Import complete!"

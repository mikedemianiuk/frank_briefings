#!/bin/bash
# Add a new scrape feed to Briefings
# Run with: bash scripts/add-scrape-feed.sh

set -e

echo "🔍 Add Scrape Feed to Briefings"
echo "================================"
echo ""

# Function to read input with default
read_with_default() {
    local prompt="$1"
    local default="$2"
    local value

    if [ -n "$default" ]; then
        read -p "$prompt [$default]: " value
        echo "${value:-$default}"
    else
        read -p "$prompt: " value
        echo "$value"
    fi
}

# Get feed details
echo "Step 1: Feed Information"
echo "------------------------"
FEED_NAME=$(read_with_default "Feed name (e.g., 'TechCrunch', 'My Competitor')" "")
FEED_URL=$(read_with_default "Feed URL" "")
FEED_CATEGORY=$(read_with_default "Category (optional)" "tech")

if [ -z "$FEED_NAME" ] || [ -z "$FEED_URL" ]; then
    echo "❌ Name and URL are required"
    exit 1
fi

echo ""
echo "Step 2: CSS Selector"
echo "--------------------"
echo "This is the CSS selector for article titles/links"
echo ""
echo "Common selectors:"
echo "  - article h2              (generic articles)"
echo "  - .article-title          (class-based)"
echo "  - .post-title a           (link inside title)"
echo "  - [data-testid='headline']  (attribute-based)"
echo ""
echo "💡 Tip: Use browser DevTools (F12) to inspect the page"
echo ""
FEED_SELECTOR=$(read_with_default "CSS selector" "")

if [ -z "$FEED_SELECTOR" ]; then
    echo "❌ Selector is required"
    exit 1
fi

# Generate UUID
FEED_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
NOW=$(date +%s)000  # Unix ms

# Confirm
echo ""
echo "📝 Feed Summary"
echo "==============="
echo "Name: $FEED_NAME"
echo "URL: $FEED_URL"
echo "Category: $FEED_CATEGORY"
echo "Selector: $FEED_SELECTOR"
echo "Type: scrape"
echo ""
read -p "Add this feed? (y/n): " confirm

if [ "$confirm" != "y" ]; then
    echo "❌ Cancelled"
    exit 1
fi

# Build SQL
SQL="INSERT INTO Feed (id, name, url, type, selector, category, isActive, isValid, errorCount, createdAt, updatedAt) VALUES ('$FEED_ID', '$FEED_NAME', '$FEED_URL', 'scrape', '$FEED_SELECTOR', '$FEED_CATEGORY', 1, 1, 0, $NOW, $NOW);"

echo ""
echo "🚀 Adding feed to database..."
echo ""

# Execute SQL
npx wrangler d1 execute DB --remote --command="$SQL"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Feed added successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Test the feed: pnpm trigger feed-fetch"
    echo "2. Check articles: npx wrangler d1 execute DB --remote --command=\"SELECT title, link FROM Article WHERE feedId = '$FEED_ID' LIMIT 5\""
    echo ""
    echo "💡 If no articles appear, you may need to adjust the selector"
else
    echo ""
    echo "❌ Failed to add feed"
    exit 1
fi

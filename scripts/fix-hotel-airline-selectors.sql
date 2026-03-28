-- Fix selectors for hotel and airline IR feeds
-- Run with: npx wrangler d1 execute DB --remote --file=scripts/fix-hotel-airline-selectors.sql

-- IHG: Use h4 a selector (headlines in news grid)
UPDATE Feed SET
  selector = 'h4 a',
  isValid = 1,
  lastError = NULL
WHERE name = 'IHG Hotels & Resorts IR';

-- Southwest: Use specific href pattern for press releases
UPDATE Feed SET
  selector = 'a[href*="/news-events/press-releases/detail/"]',
  isValid = 1,
  lastError = NULL
WHERE name = 'Southwest Airlines News';

-- Delta: Use h2 a selector (article headlines)
UPDATE Feed SET
  selector = 'h2 a',
  isValid = 1,
  lastError = NULL
WHERE name = 'Delta Air Lines News';

-- American Airlines: Use more specific headline link selector
UPDATE Feed SET
  selector = '.module_headline-link',
  isValid = 1,
  lastError = NULL
WHERE name = 'American Airlines Newsroom';

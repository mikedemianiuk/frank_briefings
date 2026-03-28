-- Fix selectors and URLs for VC Insights feeds
-- Run with: npx wrangler d1 execute DB --remote --file=scripts/fix-vc-insights-selectors.sql

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

-- First Round Review: Fix selector
UPDATE Feed SET
  selector = 'a h3',
  isValid = 1,
  lastError = NULL
WHERE name = 'First Round Review';

-- Greylock: Fix selector
UPDATE Feed SET
  selector = '.item h2',
  isValid = 1,
  lastError = NULL
WHERE name = 'Greylock (Greymatter)';

-- Lightspeed: Fix selector
UPDATE Feed SET
  selector = 'a h2',
  isValid = 1,
  lastError = NULL
WHERE name = 'Lightspeed Venture Partners';

-- Index Ventures: Fix selector
UPDATE Feed SET
  selector = 'article h3',
  isValid = 1,
  lastError = NULL
WHERE name = 'Index Ventures Perspectives';

-- Accel: Fix selector
UPDATE Feed SET
  selector = '.card_component h3',
  isValid = 1,
  lastError = NULL
WHERE name = 'Accel Noteworthy';

-- Bessemer: Fix selector
UPDATE Feed SET
  selector = '.atlas-card h2',
  isValid = 1,
  lastError = NULL
WHERE name = 'Bessemer Venture Partners (Atlas)';

-- Kleiner Perkins: Fix selector
UPDATE Feed SET
  selector = '.wp-block-post-title',
  isValid = 1,
  lastError = NULL
WHERE name = 'Kleiner Perkins Perspectives';

-- Canapi: Fix selector
UPDATE Feed SET
  selector = '.w-dyn-item h3',
  isValid = 1,
  lastError = NULL
WHERE name = 'Canapi Ventures Insights';

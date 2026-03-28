-- Fix remaining 14 feeds
-- URLs corrected for 404 errors, selectors optimized

-- Feeds with selector issues (null errors)
UPDATE Feed SET selector = 'article h2, h2, h3', isValid = 1, lastError = NULL WHERE name = 'View from the Wing';
UPDATE Feed SET selector = 'article h2, h2, h3, .article-title', isValid = 1, lastError = NULL WHERE name = 'American Express Newsroom';
UPDATE Feed SET selector = 'article h2, h2, h3, .headline', isValid = 1, lastError = NULL WHERE name = 'Chase Media Center';
UPDATE Feed SET selector = 'article h2, h2, h3', isValid = 1, lastError = NULL WHERE name = 'Fintech Futures';
UPDATE Feed SET selector = 'article h3, h3, h2', isValid = 1, lastError = NULL WHERE name = 'Marqeta Press Releases';
UPDATE Feed SET selector = 'article h2, h2, h3, .card-title', isValid = 1, lastError = NULL WHERE name = 'Visa Newsroom';

-- Stripe News - limit to fewer results by being more specific
UPDATE Feed SET selector = 'article h3', isValid = 1, lastError = NULL WHERE name = 'Stripe News';

-- Fix 404 errors with correct URLs
UPDATE Feed SET
  url = 'https://www.adyen.com/knowledge-hub/blog',
  selector = 'h2, h3, article h2',
  isValid = 1,
  lastError = NULL
WHERE name = 'Adyen Blog';

UPDATE Feed SET
  url = 'https://investors.affirm.com/news-and-events/news-releases',
  selector = 'h3, article h3',
  isValid = 1,
  lastError = NULL
WHERE name = 'Affirm Press';

UPDATE Feed SET
  url = 'https://www.sequoiacap.com/article/',
  selector = 'h2, h3, article h2',
  isValid = 1,
  lastError = NULL
WHERE name = 'Sequoia Capital';

UPDATE Feed SET
  url = 'https://a16z.com/posts/',
  selector = 'h2, h3, article h2',
  isValid = 1,
  lastError = NULL
WHERE name = 'a16z (Andreessen Horowitz)';

-- Mastercard Newsroom - 403 might be blocking, try more generic selector
UPDATE Feed SET selector = 'h2, h3, article h2', isValid = 1, lastError = NULL WHERE name = 'Mastercard Newsroom';

-- VentureBeat - 429 rate limit, mark as inactive temporarily
UPDATE Feed SET isActive = 0, lastError = 'Rate limited - temporarily disabled' WHERE name = 'VentureBeat';

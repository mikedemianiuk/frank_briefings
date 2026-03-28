-- Fix selectors for top 10 priority feeds
-- Run with: npx wrangler d1 execute DB --remote --file=scripts/fix-selectors.sql

-- 1. Stripe News - try different selector
UPDATE Feed SET selector = 'h2, h3', isValid = 1, lastError = NULL WHERE name = 'Stripe News';

-- 2. Plaid Blog - try more generic selector
UPDATE Feed SET selector = 'h2, h3', isValid = 1, lastError = NULL WHERE name = 'Plaid Blog';

-- 3. PayPal Newsroom - try simpler selector
UPDATE Feed SET selector = 'h3, h4', isValid = 1, lastError = NULL WHERE name = 'PayPal Newsroom';

-- 4. The Points Guy - try article structure
UPDATE Feed SET selector = 'article h2, .post-title, h2', isValid = 1, lastError = NULL WHERE name = 'The Points Guy';

-- 5. One Mile at a Time - WordPress blog selector
UPDATE Feed SET selector = 'h2, article h2', isValid = 1, lastError = NULL WHERE name = 'One Mile at a Time';

-- 6. Revolut Blog - try generic blog selectors
UPDATE Feed SET selector = 'h2, h3, article h2', isValid = 1, lastError = NULL WHERE name = 'Revolut Blog';

-- 7. Loyalty Lobby - WordPress standard
UPDATE Feed SET selector = 'h2, article h2', isValid = 1, lastError = NULL WHERE name = 'Loyalty Lobby';

-- 8. PYMNTS.com - try article headers
UPDATE Feed SET selector = 'h2, h3, article h2', isValid = 1, lastError = NULL WHERE name = 'PYMNTS.com';

-- 9. View from the Wing - WordPress blog
UPDATE Feed SET selector = 'h2, article h2', isValid = 1, lastError = NULL WHERE name = 'View from the Wing';

-- 10. Klarna News - try multiple selectors
UPDATE Feed SET selector = 'h2, h3, h4', isValid = 1, lastError = NULL WHERE name = 'Klarna News';

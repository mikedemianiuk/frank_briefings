-- Fix feed types and URLs for Forbes FinTech 50 companies (should be scrape, not rss)
UPDATE Feed SET type='scrape', isValid=1, errorCount=0 WHERE url='https://plaid.com/blog/';
UPDATE Feed SET type='scrape', isValid=1, errorCount=0 WHERE url='https://stripe.com/blog';
UPDATE Feed SET type='scrape', isValid=1, errorCount=0 WHERE url='https://ramp.com/blog';
UPDATE Feed SET type='scrape', isValid=1, errorCount=0 WHERE url='https://mercury.com/blog';
UPDATE Feed SET type='scrape', isValid=1, errorCount=0 WHERE url='https://www.socure.com/news-and-events';
UPDATE Feed SET type='scrape', isValid=1, errorCount=0 WHERE url='https://withpersona.com/blog';
UPDATE Feed SET type='scrape', isValid=1, errorCount=0 WHERE url='https://www.brico.com/news';
UPDATE Feed SET type='scrape', isValid=1, errorCount=0 WHERE url='https://securitize.io/blog';
UPDATE Feed SET type='scrape', isValid=1, errorCount=0 WHERE url='https://www.lead.bank/news';
UPDATE Feed SET type='scrape', isValid=1, errorCount=0 WHERE url='https://column.com/blog';
UPDATE Feed SET type='scrape', isValid=1, errorCount=0 WHERE url='https://increase.com/blog';
UPDATE Feed SET type='scrape', isValid=1, errorCount=0 WHERE url='https://www.highnote.com/blog';
UPDATE Feed SET type='scrape', isValid=1, errorCount=0 WHERE url='https://www.zip.co/us/newsroom';
UPDATE Feed SET type='scrape', isValid=1, errorCount=0 WHERE url='https://www.coalitioninc.com/blog';

-- Fix RSS feed URLs that are returning 404
UPDATE Feed SET url='https://www.finextra.com/rss/headlines.xml', isValid=1, errorCount=0 WHERE name='Finextra';
UPDATE Feed SET url='https://www.fintechfutures.com/feed', isValid=1, errorCount=0 WHERE name='Fintech Futures';

-- Deactivate feeds with persistent 404 errors (we can investigate these separately)
UPDATE Feed SET isActive=0 WHERE url IN (
  'https://investors.affirm.com/news-and-events/news-releases',
  'https://www.sequoiacap.com/article/',
  'https://www.socure.com/news-and-events',
  'https://www.brico.com/news',
  'https://www.lead.bank/news',
  'https://increase.com/blog'
);

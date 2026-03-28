-- Add Hotel and Airline Investor Relations feeds
-- Run with: npx wrangler d1 execute DB --remote --file=scripts/add-hotel-airline-feeds.sql

-- Hotel Investor Relations
INSERT INTO Feed (id, name, url, type, selector, category, isActive, isValid, errorCount, createdAt, updatedAt) VALUES
('a1b2c3d4-0001-4000-8000-000000000032', 'IHG Hotels & Resorts IR', 'https://www.ihgplc.com/en/news-and-media/news-releases', 'scrape', 'div.news-listing__item', 'Investor Relations', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
('a1b2c3d4-0001-4000-8000-000000000033', 'Hyatt Investor Relations', 'https://investors.hyatt.com/investor-news/default.aspx', 'scrape', 'div.module_item', 'Investor Relations', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);

-- Airline Investor Relations
INSERT INTO Feed (id, name, url, type, selector, category, isActive, isValid, errorCount, createdAt, updatedAt) VALUES
('a1b2c3d4-0001-4000-8000-000000000034', 'United Airlines IR', 'https://ir.united.com/news-releases', 'scrape', 'div.item_wrapper', 'Investor Relations', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
('a1b2c3d4-0001-4000-8000-000000000035', 'Southwest Airlines News', 'https://www.southwestairlinesinvestorrelations.com/news-and-events/news-releases', 'scrape', 'div.module_item', 'Investor Relations', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
('a1b2c3d4-0001-4000-8000-000000000036', 'Delta Air Lines News', 'https://news.delta.com/', 'scrape', 'div.views-row', 'Investor Relations', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
('a1b2c3d4-0001-4000-8000-000000000037', 'American Airlines Newsroom', 'https://news.aa.com/news/default.aspx', 'scrape', 'div.module_item', 'Investor Relations', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);

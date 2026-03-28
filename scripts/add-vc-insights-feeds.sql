-- Add Top 10 Venture Capital Insights feeds
-- Run with: npx wrangler d1 execute DB --remote --file=scripts/add-vc-insights-feeds.sql

-- Note: a16z and Sequoia already exist with different URLs - these are alternatives
-- You may want to update the existing ones instead of adding duplicates

INSERT INTO Feed (id, name, url, type, selector, category, isActive, isValid, errorCount, createdAt, updatedAt) VALUES
-- Already exists: a16z (Andreessen Horowitz) at https://a16z.com/posts/
-- This is an alternative URL for articles
('a1b2c3d4-0001-4000-8000-000000000100', 'a16z Articles', 'https://a16z.com/articles/', 'scrape', 'h2.entry-title', 'VC Insights', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

-- Already exists: Sequoia Capital at https://www.sequoiacap.com/article/
-- This is an alternative URL for stories
('a1b2c3d4-0001-4000-8000-000000000101', 'Sequoia Capital Stories', 'https://www.sequoiacap.com/our-stories/', 'scrape', 'div.content', 'VC Insights', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

('a1b2c3d4-0001-4000-8000-000000000102', 'Union Square Ventures (USV)', 'https://www.usv.com/writing/', 'scrape', 'div.post', 'VC Insights', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

('a1b2c3d4-0001-4000-8000-000000000103', 'First Round Review', 'https://review.firstround.com/', 'scrape', 'div.article-card', 'VC Insights', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

('a1b2c3d4-0001-4000-8000-000000000104', 'Greylock (Greymatter)', 'https://greylock.com/greymatter/', 'scrape', 'div.card-content', 'VC Insights', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

('a1b2c3d4-0001-4000-8000-000000000105', 'Lightspeed Venture Partners', 'https://lsvp.com/stories/', 'scrape', 'article.post', 'VC Insights', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

('a1b2c3d4-0001-4000-8000-000000000106', 'Index Ventures Perspectives', 'https://www.indexventures.com/perspectives/', 'scrape', 'a.c-card', 'VC Insights', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

('a1b2c3d4-0001-4000-8000-000000000107', 'Accel Noteworthy', 'https://www.accel.com/noteworthy', 'scrape', 'div.collection-item', 'VC Insights', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

('a1b2c3d4-0001-4000-8000-000000000108', 'Bessemer Venture Partners (Atlas)', 'https://www.bvp.com/atlas', 'scrape', 'div.atlas-card', 'VC Insights', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

('a1b2c3d4-0001-4000-8000-000000000109', 'Kleiner Perkins Perspectives', 'https://www.kleinerperkins.com/perspectives', 'scrape', 'div.post-preview', 'VC Insights', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

('a1b2c3d4-0001-4000-8000-000000000110', 'Canapi Ventures Insights', 'https://www.canapi.com/insights', 'scrape', 'div.collection-item', 'VC Insights', 1, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);

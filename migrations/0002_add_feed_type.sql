-- Migration: Add type and selector to Feed table
ALTER TABLE Feed ADD COLUMN type TEXT DEFAULT 'rss';
ALTER TABLE Feed ADD COLUMN selector TEXT;
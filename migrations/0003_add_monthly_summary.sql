-- Migration: Add MonthlySummary table for monthly reports
-- Date: 2026-02-22

CREATE TABLE IF NOT EXISTS MonthlySummary (
  id TEXT PRIMARY KEY,
  monthStartDate INTEGER NOT NULL, -- unix ms timestamp
  monthEndDate INTEGER NOT NULL,   -- unix ms timestamp
  title TEXT NOT NULL,
  executiveSummary TEXT NOT NULL,   -- High-level overview (250-500 words)
  marketAnalysis TEXT NOT NULL,     -- Deep dive into market trends
  competitiveLandscape TEXT NOT NULL, -- Competitive positioning analysis
  productDevelopment TEXT NOT NULL,  -- Product and technology trends
  strategicImplications TEXT NOT NULL, -- Forward-looking strategic insights
  topics TEXT,                       -- JSON array of key topics
  sentAt INTEGER,                    -- unix ms timestamp when email was sent
  createdAt INTEGER NOT NULL,        -- unix ms timestamp
  updatedAt INTEGER NOT NULL,        -- unix ms timestamp
  UNIQUE(monthStartDate, monthEndDate)
);

-- Index for efficient date-range queries
CREATE INDEX IF NOT EXISTS idx_monthly_summary_dates ON MonthlySummary(monthStartDate, monthEndDate);

-- Index for sent status
CREATE INDEX IF NOT EXISTS idx_monthly_summary_sent ON MonthlySummary(sentAt);

-- Create relation table to link weekly summaries to monthly summaries
CREATE TABLE IF NOT EXISTS WeeklyMonthlySummaryRelation (
  weeklySummaryId TEXT NOT NULL,
  monthlySummaryId TEXT NOT NULL,
  PRIMARY KEY (weeklySummaryId, monthlySummaryId),
  FOREIGN KEY (weeklySummaryId) REFERENCES WeeklySummary(id) ON DELETE CASCADE,
  FOREIGN KEY (monthlySummaryId) REFERENCES MonthlySummary(id) ON DELETE CASCADE
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_weekly_monthly_relation_weekly ON WeeklyMonthlySummaryRelation(weeklySummaryId);
CREATE INDEX IF NOT EXISTS idx_weekly_monthly_relation_monthly ON WeeklyMonthlySummaryRelation(monthlySummaryId);

-- Migration script to update leaderboard_entries table for cast-based schema
-- Run this in your Neon/Vercel Postgres database

-- Step 1: Drop the old table if it exists with the old schema
DROP TABLE IF EXISTS leaderboard_entries;

-- Step 2: Create the new cast-based table
CREATE TABLE leaderboard_entries (
  id SERIAL PRIMARY KEY,
  cast_hash VARCHAR(255) NOT NULL UNIQUE,
  creator_fid INTEGER NOT NULL,
  creator_username VARCHAR(255) NOT NULL,
  creator_display_name VARCHAR(255),
  creator_pfp_url TEXT,
  cast_text TEXT NOT NULL,
  description TEXT NOT NULL,
  cast_timestamp TIMESTAMP NOT NULL,
  total_higher_staked NUMERIC(30, 18) NOT NULL,
  staker_fids INTEGER[] NOT NULL DEFAULT '{}',
  usd_value NUMERIC(15, 2),
  rank INTEGER,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Step 3: Create indexes for performance
CREATE INDEX idx_total_higher_staked ON leaderboard_entries(total_higher_staked DESC);
CREATE INDEX idx_rank ON leaderboard_entries(rank);
CREATE INDEX idx_cast_hash ON leaderboard_entries(cast_hash);
CREATE INDEX idx_creator_fid ON leaderboard_entries(creator_fid);

-- Done! The table is now ready for cast-based leaderboard entries.

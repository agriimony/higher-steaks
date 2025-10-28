-- Leaderboard entries table
CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id SERIAL PRIMARY KEY,
  fid INTEGER NOT NULL UNIQUE,
  username VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  pfp_url TEXT,
  cast_hash VARCHAR(255) NOT NULL,
  cast_text TEXT NOT NULL,
  description TEXT NOT NULL,
  cast_timestamp TIMESTAMP NOT NULL,
  higher_balance NUMERIC(30, 18) NOT NULL,
  usd_value NUMERIC(15, 2),
  rank INTEGER,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_higher_balance ON leaderboard_entries(higher_balance DESC);
CREATE INDEX IF NOT EXISTS idx_rank ON leaderboard_entries(rank);
CREATE INDEX IF NOT EXISTS idx_fid ON leaderboard_entries(fid);


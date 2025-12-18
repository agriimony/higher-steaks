-- Leaderboard entries table (cast-based)
CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id SERIAL PRIMARY KEY,
  cast_hash VARCHAR(255) NOT NULL UNIQUE,
  creator_fid INTEGER NOT NULL,
  creator_username VARCHAR(255) NOT NULL,
  creator_display_name VARCHAR(255),
  creator_pfp_url TEXT,
  cast_text TEXT NOT NULL,
  description TEXT NOT NULL,
  cast_timestamp TIMESTAMP NOT NULL,
  total_higher_staked NUMERIC(30, 18) NOT NULL, -- Sum of caster_stake_amounts + supporter_stake_amounts
  staker_fids INTEGER[] NOT NULL DEFAULT '{}', -- [creator_fid, ...supporter_stake_fids] (for backward compatibility)
  usd_value NUMERIC(15, 2),
  rank INTEGER,
  updated_at TIMESTAMP DEFAULT NOW(),
  -- New columns for caster/supporter stake separation
  caster_stake_lockup_ids INTEGER[] DEFAULT '{}',
  caster_stake_amounts NUMERIC[] DEFAULT '{}',
  caster_stake_unlock_times INTEGER[] DEFAULT '{}',
  caster_stake_lock_times BIGINT[] DEFAULT '{}', -- ADDED: Missing column
  caster_stake_unlocked BOOLEAN[] DEFAULT '{}',
  supporter_stake_lockup_ids INTEGER[] DEFAULT '{}',
  supporter_stake_amounts NUMERIC[] DEFAULT '{}',
  supporter_stake_fids INTEGER[] DEFAULT '{}',
  supporter_stake_unlock_times INTEGER[] DEFAULT '{}',
  supporter_stake_lock_times BIGINT[] DEFAULT '{}', -- ADDED: Missing column
  supporter_stake_unlocked BOOLEAN[] DEFAULT '{}',
  cast_state VARCHAR(20) DEFAULT 'higher' -- 'invalid', 'valid', 'higher', or 'expired'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_total_higher_staked ON leaderboard_entries(total_higher_staked DESC);
CREATE INDEX IF NOT EXISTS idx_rank ON leaderboard_entries(rank);
CREATE INDEX IF NOT EXISTS idx_cast_hash ON leaderboard_entries(cast_hash);
CREATE INDEX IF NOT EXISTS idx_creator_fid ON leaderboard_entries(creator_fid);
CREATE INDEX IF NOT EXISTS idx_cast_state ON leaderboard_entries(cast_state);
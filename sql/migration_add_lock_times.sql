-- Add lock time arrays to leaderboard_entries
ALTER TABLE leaderboard_entries
	ADD COLUMN IF NOT EXISTS caster_stake_lock_times bigint[] DEFAULT '{}'::bigint[],
	ADD COLUMN IF NOT EXISTS supporter_stake_lock_times bigint[] DEFAULT '{}'::bigint[];

-- Optional: indexes for querying by lock times (commented out by default)
-- CREATE INDEX IF NOT EXISTS idx_le_caster_lock_times ON leaderboard_entries USING gin (caster_stake_lock_times);
-- CREATE INDEX IF NOT EXISTS idx_le_supporter_lock_times ON leaderboard_entries USING gin (supporter_stake_lock_times);

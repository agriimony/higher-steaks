-- Migration to add new columns for caster/supporter stake separation
-- This migration adds columns to support the new schema where stakes are
-- classified as caster or supporter stakes with separate arrays

-- Add new columns to leaderboard_entries table
ALTER TABLE leaderboard_entries
  ADD COLUMN IF NOT EXISTS caster_stake_lockup_ids INTEGER[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS caster_stake_amounts NUMERIC[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS caster_stake_unlock_times INTEGER[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS supporter_stake_lockup_ids INTEGER[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS supporter_stake_amounts NUMERIC[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS supporter_stake_fids INTEGER[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS supporter_stake_pfps TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cast_state VARCHAR(20) DEFAULT 'higher';

-- Create index for cast_state for filtering
CREATE INDEX IF NOT EXISTS idx_cast_state ON leaderboard_entries(cast_state);

-- Note: Column relationships:
-- - total_higher_staked = sum of all caster_stake_amounts + sum of all supporter_stake_amounts
--   (calculated and stored for quick queries/sorting)
-- - staker_fids = [creator_fid, ...supporter_stake_fids] (for backward compatibility)
--   (can be derived from creator_fid + supporter_stake_fids)
-- - supporter_stake_pfps = array of profile picture URLs corresponding to supporter_stake_fids
--   (same order as supporter_stake_fids array)
-- - supporter stakes are only valid if unlockTime > min caster stake unlockTime
--
-- Existing data will need to be backfilled via the cron job which will:
-- 1. Query onchain lockup data
-- 2. Classify stakes as caster vs supporter
-- 3. Fetch supporter PFPs from Neynar
-- 4. Filter supporter stakes (unlockTime > min caster stake unlockTime)
-- 5. Populate all columns including backward-compatible ones


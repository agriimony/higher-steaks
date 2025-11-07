-- Migration: Add unlock times and unlocked flags for lockups
-- This migration adds columns to track supporter stake unlock times and unlocked flags
-- for both caster and supporter stakes in the leaderboard_entries table.

-- Add supporter_stake_unlock_times column (array of integers)
ALTER TABLE leaderboard_entries 
ADD COLUMN IF NOT EXISTS supporter_stake_unlock_times INTEGER[] DEFAULT '{}';

-- Add caster_stake_unlocked column (array of booleans)
-- caster_stake_unlocked[i] corresponds to caster_stake_lockup_ids[i]
ALTER TABLE leaderboard_entries 
ADD COLUMN IF NOT EXISTS caster_stake_unlocked BOOLEAN[] DEFAULT '{}';

-- Add supporter_stake_unlocked column (array of booleans)
-- supporter_stake_unlocked[i] corresponds to supporter_stake_lockup_ids[i]
ALTER TABLE leaderboard_entries 
ADD COLUMN IF NOT EXISTS supporter_stake_unlocked BOOLEAN[] DEFAULT '{}';

-- Note: Existing data will need to be backfilled via webhook replay or cron job update
-- Arrays are indexed by position - caster_stake_unlocked[i] corresponds to caster_stake_lockup_ids[i],
-- and supporter_stake_unlocked[i] corresponds to supporter_stake_lockup_ids[i]


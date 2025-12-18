-- Drop supporter stake PFPs column (migrating to on-demand Neynar fetch)
ALTER TABLE leaderboard_entries
  DROP COLUMN IF EXISTS supporter_stake_pfps;



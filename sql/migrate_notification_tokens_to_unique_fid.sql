-- Migration: Update notification_tokens to have only one row per FID
-- This script should be run to update existing databases

-- Step 1: Remove duplicate tokens, keeping only the most recent one per FID
DELETE FROM notification_tokens
WHERE id NOT IN (
  SELECT DISTINCT ON (fid) id
  FROM notification_tokens
  ORDER BY fid, updated_at DESC, id DESC
);

-- Step 2: Drop the old unique constraint on (fid, token)
ALTER TABLE notification_tokens
DROP CONSTRAINT IF EXISTS notification_tokens_fid_token_key;

-- Step 3: Add unique constraint on fid only (if it doesn't exist)
-- Note: This will fail if there are still duplicates, so Step 1 is important
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'notification_tokens_fid_key'
  ) THEN
    ALTER TABLE notification_tokens
    ADD CONSTRAINT notification_tokens_fid_key UNIQUE (fid);
  END IF;
END $$;

-- Verify: Check that there's only one row per FID
-- SELECT fid, COUNT(*) as count 
-- FROM notification_tokens 
-- GROUP BY fid 
-- HAVING COUNT(*) > 1;
-- This query should return no rows if migration was successful

-- Migration: Add threshold_usd column to notification_tokens table
-- This script should be run to update existing databases

-- Add threshold_usd column with default value of 10.00
ALTER TABLE notification_tokens
ADD COLUMN IF NOT EXISTS threshold_usd DECIMAL(10, 2) DEFAULT 10.00;

-- Update existing rows to have threshold of 10.00 (in case they were created before default was set)
UPDATE notification_tokens
SET threshold_usd = 10.00
WHERE threshold_usd IS NULL;

-- Verify: Check that all rows have a threshold
-- SELECT fid, threshold_usd FROM notification_tokens;
-- All rows should have threshold_usd = 10.00 or the value they set

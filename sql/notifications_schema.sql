-- Notification tracking table
-- Note: Notification tokens are stored and managed by Neynar, not in our database.
-- This table only tracks which notifications we've sent to prevent duplicates.

CREATE TABLE IF NOT EXISTS notification_sent (
  id SERIAL PRIMARY KEY,
  notification_type VARCHAR(50) NOT NULL, -- 'stake_expired' or 'supporter_added'
  fid INTEGER NOT NULL,
  reference_id VARCHAR(255) NOT NULL, -- lockup_id for expired, cast_hash+lockup_id for supporter
  sent_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(notification_type, fid, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_sent_fid ON notification_sent(fid);
CREATE INDEX IF NOT EXISTS idx_notification_sent_type ON notification_sent(notification_type);

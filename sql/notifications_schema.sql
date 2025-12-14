-- Notification tokens table (stores tokens from Farcaster webhook events)
CREATE TABLE IF NOT EXISTS notification_tokens (
  id SERIAL PRIMARY KEY,
  fid INTEGER NOT NULL,
  token TEXT NOT NULL,
  notification_url TEXT NOT NULL,
  enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(fid, token)
);

CREATE INDEX IF NOT EXISTS idx_notification_tokens_fid ON notification_tokens(fid);
CREATE INDEX IF NOT EXISTS idx_notification_tokens_enabled ON notification_tokens(enabled) WHERE enabled = true;

-- Notification tracking table (tracks which notifications we've sent to prevent duplicates)
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

import { sql } from '@vercel/postgres';

// Format token amount with K/M/B suffixes (same as UserModal)
function formatTokenAmount(amount: string): string {
  const safe = (amount ?? '0').toString();
  const num = parseFloat(safe.replace(/,/g, ''));
  if (isNaN(num)) return safe;
  
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(2) + 'B';
  } else if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(2) + 'M';
  } else if (num >= 1_000) {
    return (num / 1_000).toFixed(2) + 'K';
  } else {
    return num.toFixed(2);
  }
}

// Get HIGHER token price in USD from CoinGecko
async function getHigherPrice(): Promise<number> {
  try {
    const priceResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=higher&vs_currencies=usd', {
      next: { revalidate: 300 },
    });
    if (priceResponse.ok) {
      const priceData = await priceResponse.json();
      return priceData?.higher?.usd || 0;
    }
  } catch (err) {
    console.warn('[notification-service] Failed to fetch HIGHER price:', err);
  }
  return 0;
}

// Check if notification was already sent to prevent duplicates
async function hasNotificationBeenSent(
  notificationType: 'stake_expired' | 'supporter_added',
  fid: number,
  referenceId: string
): Promise<boolean> {
  try {
    const result = await sql`
      SELECT id FROM notification_sent
      WHERE notification_type = ${notificationType}
        AND fid = ${fid}
        AND reference_id = ${referenceId}
      LIMIT 1
    `;
    return result.rows.length > 0;
  } catch (err) {
    console.error('[notification-service] Error checking notification_sent:', err);
    return false;
  }
}

// Mark notification as sent
async function markNotificationSent(
  notificationType: 'stake_expired' | 'supporter_added',
  fid: number,
  referenceId: string
): Promise<void> {
  try {
    await sql`
      INSERT INTO notification_sent (notification_type, fid, reference_id)
      VALUES (${notificationType}, ${fid}, ${referenceId})
      ON CONFLICT (notification_type, fid, reference_id) DO NOTHING
    `;
  } catch (err) {
    console.error('[notification-service] Error marking notification as sent:', err);
  }
}

// Get notification token from database (stored via webhook events)
async function getNotificationToken(fid: number): Promise<{ token: string; url: string } | null> {
  try {
    // Query database for enabled notification token
    const result = await sql`
      SELECT token, notification_url 
      FROM notification_tokens 
      WHERE fid = ${fid} AND enabled = true 
      LIMIT 1
    `;
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      token: row.token,
      url: row.notification_url,
    };
  } catch (err) {
    console.error('[notification-service] Error getting notification token:', err);
    return null;
  }
}

// Send notification via Farcaster notification URL
async function sendNotification(
  fid: number,
  title: string,
  body: string,
  targetUrl: string
): Promise<boolean> {
  try {
    // Get token from database
    const tokenData = await getNotificationToken(fid);
    if (!tokenData) {
      console.log(`[notification-service] No notification token for FID ${fid}`);
      return false;
    }

    // Send to Farcaster notification URL
    // Reference: https://miniapps.farcaster.xyz/docs/guides/notifications
    const notificationId = `higher-steaks-${Date.now()}-${fid}`;
    
    const response = await fetch(tokenData.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notificationId,
        title,
        body,
        targetUrl,
        tokens: [tokenData.token],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[notification-service] Failed to send notification: ${response.status} ${errorText}`);
      
      // Handle invalid tokens - remove from database
      if (response.status === 400 || response.status === 401) {
        await sql`
          UPDATE notification_tokens
          SET enabled = false, updated_at = NOW()
          WHERE fid = ${fid} AND token = ${tokenData.token}
        `;
      }
      
      return false;
    }

    const result = await response.json();
    
    // Handle response: remove invalid tokens, track rate-limited tokens
    if (result.invalidTokens && result.invalidTokens.length > 0) {
      for (const invalidToken of result.invalidTokens) {
        await sql`
          UPDATE notification_tokens
          SET enabled = false, updated_at = NOW()
          WHERE fid = ${fid} AND token = ${invalidToken}
        `;
      }
    }

    return result.successfulTokens && result.successfulTokens.length > 0;
  } catch (err) {
    console.error('[notification-service] Error sending notification:', err);
    return false;
  }
}

// Send stake expiration notification
export async function sendStakeExpiredNotification(
  fid: number,
  lockupId: string,
  amount: string,
  castOwner: { fid: number; username: string }
): Promise<boolean> {
  const referenceId = lockupId;
  
  // Check if already sent
  if (await hasNotificationBeenSent('stake_expired', fid, referenceId)) {
    return false;
  }

  const formattedAmount = formatTokenAmount(amount);
  const title = 'Higher Steak Cooked!';
  const body = `Your stake of ${formattedAmount} HIGHER on @${castOwner.username} has completed. Withdraw now to continue supporting others!`;
  const targetUrl = `https://higher-steaks.vercel.app?fid=${fid}`;

  const success = await sendNotification(fid, title, body, targetUrl);
  
  if (success) {
    await markNotificationSent('stake_expired', fid, referenceId);
  }
  
  return success;
}

// Send supporter notification
export async function sendSupporterNotification(
  castOwnerFid: number,
  supporterFid: number,
  amount: string,
  castHash: string,
  description: string,
  supporterUsername: string
): Promise<boolean> {
  // Check $10 USD minimum
  const pricePerToken = await getHigherPrice();
  const amountNum = parseFloat(amount.replace(/,/g, ''));
  const usdValue = amountNum * pricePerToken;
  
  if (usdValue < 10) {
    console.log(`[notification-service] Supporter stake ${usdValue} USD below $10 minimum`);
    return false;
  }

  const referenceId = `${castHash}-${supporterFid}`;
  
  // Check if already sent
  if (await hasNotificationBeenSent('supporter_added', castOwnerFid, referenceId)) {
    return false;
  }

  const formattedAmount = formatTokenAmount(amount);
  const title = `@${supporterUsername} is supporting you!`;
  const body = `@${supporterUsername} just staked ${formattedAmount} HIGHER on your cast: ${description}`;
  const targetUrl = `https://higher-steaks.vercel.app/cast/${castHash}`;

  const success = await sendNotification(castOwnerFid, title, body, targetUrl);
  
  if (success) {
    await markNotificationSent('supporter_added', castOwnerFid, referenceId);
  }
  
  return success;
}

// Check and send expired stake notifications (for cron job)
export async function checkAndSendExpiredStakeNotifications(): Promise<number> {
  try {
    const currentTime = Math.floor(Date.now() / 1000);
    
    // Query expired stakes from database (both caster and supporter)
    const result = await sql`
      SELECT DISTINCT
        le.creator_fid,
        le.creator_username,
        le.caster_stake_lockup_ids,
        le.caster_stake_amounts,
        le.caster_stake_unlock_times,
        le.caster_stake_unlocked,
        le.supporter_stake_lockup_ids,
        le.supporter_stake_amounts,
        le.supporter_stake_fids,
        le.supporter_stake_unlock_times,
        le.supporter_stake_unlocked
      FROM leaderboard_entries le
      WHERE (le.caster_stake_unlock_times IS NOT NULL AND array_length(le.caster_stake_unlock_times, 1) > 0)
         OR (le.supporter_stake_unlock_times IS NOT NULL AND array_length(le.supporter_stake_unlock_times, 1) > 0)
    `;

    let sentCount = 0;

    for (const row of result.rows) {
      const creatorFid = row.creator_fid;
      const creatorUsername = row.creator_username || `user-${creatorFid}`;

      // Check caster stakes (stakes by cast owner on their own cast)
      const casterLockupIds = row.caster_stake_lockup_ids || [];
      const casterAmounts = row.caster_stake_amounts || [];
      const casterUnlockTimes = row.caster_stake_unlock_times || [];
      const casterUnlocked = row.caster_stake_unlocked || [];

      for (let i = 0; i < casterLockupIds.length; i++) {
        const unlockTime = casterUnlockTimes[i];
        const isUnlocked = casterUnlocked[i];
        const lockupId = casterLockupIds[i]?.toString();
        const amount = casterAmounts[i]?.toString() || '0';

        if (unlockTime && unlockTime <= currentTime && !isUnlocked && lockupId) {
          const success = await sendStakeExpiredNotification(
            creatorFid,
            lockupId,
            amount,
            { fid: creatorFid, username: creatorUsername }
          );
          if (success) {
            sentCount++;
          }
        }
      }

      // Check supporter stakes (stakes by supporters on this cast)
      const supporterLockupIds = row.supporter_stake_lockup_ids || [];
      const supporterAmounts = row.supporter_stake_amounts || [];
      const supporterFids = row.supporter_stake_fids || [];
      const supporterUnlockTimes = row.supporter_stake_unlock_times || [];
      const supporterUnlocked = row.supporter_stake_unlocked || [];

      for (let i = 0; i < supporterLockupIds.length; i++) {
        const unlockTime = supporterUnlockTimes[i];
        const isUnlocked = supporterUnlocked[i];
        const lockupId = supporterLockupIds[i]?.toString();
        const amount = supporterAmounts[i]?.toString() || '0';
        const supporterFid = supporterFids[i];

        if (unlockTime && unlockTime <= currentTime && !isUnlocked && lockupId && supporterFid) {
          // For supporter stakes, notify the supporter (not the cast owner)
          // The cast owner is the "castOwner" in the notification message
          const success = await sendStakeExpiredNotification(
            supporterFid,
            lockupId,
            amount,
            { fid: creatorFid, username: creatorUsername }
          );
          if (success) {
            sentCount++;
          }
        }
      }
    }

    return sentCount;
  } catch (err) {
    console.error('[notification-service] Error checking expired stakes:', err);
    return 0;
  }
}

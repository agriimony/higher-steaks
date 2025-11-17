import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Import contract addresses to filter events
import { LOCKUP_CONTRACT, HIGHER_TOKEN_ADDRESS } from '@/lib/contracts';
import { isValidCastHash } from '@/lib/cast-helpers';
import { getHigherCast, castExistsInDB, upsertHigherCast } from '@/lib/services/db-service';
import { sql } from '@vercel/postgres';
import { getFidsFromAddresses } from '@/lib/services/stake-service';
import { getCastByHash } from '@/lib/services/cast-service';

// Verify webhook signature from CDP
// CDP uses X-Hook0-Signature header with format: t=timestamp,h=headers,v1=signature
function verifySignature(payload: string, signatureHeader: string | null, headers: Record<string, string>, secrets: string[]): boolean {
  if (!signatureHeader) {
    console.error('[CDP Webhook] No signature header provided');
    return false;
  }
  
  if (secrets.length === 0) {
    console.error('[CDP Webhook] No webhook secrets configured');
    return false;
  }
  
  try {
    // Parse the signature header: t=timestamp,h=headers,v0=signature or v1=signature
    const elements = signatureHeader.split(',');
    const timestampMatch = elements.find((e: string) => e.startsWith('t='));
    const headerNamesMatch = elements.find((e: string) => e.startsWith('h='));
    const providedSignatureMatchV1 = elements.find((e: string) => e.startsWith('v1='));
    const providedSignatureMatchV0 = elements.find((e: string) => e.startsWith('v0='));
    const providedSignatureMatch = providedSignatureMatchV1 || providedSignatureMatchV0;
    
    if (!timestampMatch || !headerNamesMatch || !providedSignatureMatch) {
      console.error('[CDP Webhook] Malformed signature header');
      return false;
    }
    
    const timestamp = timestampMatch.split('=')[1];
    const headerNames = headerNamesMatch.split('=')[1];
    const providedSignature = providedSignatureMatch.split('=')[1];
    
    // Build the header values string
    const headerNameList = headerNames.split(' ');
    const headerValues = headerNameList.map((name: string) => headers[name.toLowerCase()] || '').join('.');
    
    // Construct the signed payload
    const signedPayload = `${timestamp}.${headerNames}.${headerValues}.${payload}`;
    
    console.log('[CDP Webhook Debug] Header names:', headerNames);
    console.log('[CDP Webhook Debug] Header values:', headerValues);
    console.log('[CDP Webhook Debug] Signed payload preview:', signedPayload.substring(0, 300));
    console.log('[CDP Webhook Debug] Trying', secrets.length, 'secrets...');
    
    // Try each secret until one matches
    const providedBuffer = Buffer.from(providedSignature, 'hex');
    
    for (let i = 0; i < secrets.length; i++) {
      const secret = secrets[i];
      console.log(`[CDP Webhook Debug] Trying secret ${i + 1}/${secrets.length}, length: ${secret.length}`);
      
      try {
        // Compute the expected signature
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(signedPayload, 'utf8');
        const expectedSignature = hmac.digest('hex');
        
        const expectedBuffer = Buffer.from(expectedSignature, 'hex');
        
        if (expectedBuffer.length !== providedBuffer.length) {
          console.log(`[CDP Webhook Debug] Secret ${i + 1}: length mismatch`);
          continue;
        }
        
        const signaturesMatch = crypto.timingSafeEqual(expectedBuffer, providedBuffer);
        
        if (signaturesMatch) {
          console.log(`[CDP Webhook Debug] Secret ${i + 1} matched!`);
          
          // Verify the timestamp to prevent replay attacks (within 5 minutes)
          const webhookTime = parseInt(timestamp) * 1000;
          const currentTime = Date.now();
          const ageMinutes = (currentTime - webhookTime) / (1000 * 60);
          
          if (ageMinutes > 5) {
            console.error(`[CDP Webhook] Webhook timestamp too old: ${ageMinutes.toFixed(1)} minutes`);
            return false;
          }
          
          return true;
        }
      } catch (error) {
        console.log(`[CDP Webhook Debug] Secret ${i + 1}: error:`, error);
      }
    }
    
    console.error('[CDP Webhook] No matching secret found');
    return false;
  } catch (error) {
    console.error('[CDP Webhook] Signature verification error:', error);
    return false;
  }
}

// Parse and normalize event data from CDP
function parseCDPEvent(body: any): { type: string; data: any } | null {
  try {
    // CDP webhook payload is a flat structure with event details at the top level
    const contractAddress = body.contract_address?.toLowerCase();
    const eventName = body.event_name;
    const parameters = body.parameters || {};
    const transactionHash = body.transaction_hash;
    
    console.log('[CDP Webhook] Received event:', {
      contractAddress,
      eventName,
      transactionHash: body.transaction_hash,
    });
    
    // Handle LockUpCreated events
    if (contractAddress === LOCKUP_CONTRACT.toLowerCase() && eventName === 'LockUpCreated') {
      return {
        type: 'lockup_created',
        data: {
          lockUpId: parameters.lockUpId || parameters.lockup_id,
          token: parameters.token,
          receiver: parameters.receiver,
          amount: parameters.amount,
          unlockTime: parameters.unlockTime || parameters.unlock_time,
          title: parameters.title,
          transactionHash,
        },
      };
    }
    
    // Handle Unlock events
    if (contractAddress === LOCKUP_CONTRACT.toLowerCase() && eventName === 'Unlock') {
      return {
        type: 'unlock',
        data: {
          lockUpId: parameters.lockUpId || parameters.lockup_id,
          token: parameters.token,
          receiver: parameters.receiver,
          transactionHash,
        },
      };
    }
    
    // Handle Transfer events (HIGHER token)
    if (contractAddress === HIGHER_TOKEN_ADDRESS.toLowerCase() && eventName === 'Transfer') {
      const from = (parameters.from || '').toLowerCase();
      const to = (parameters.to || '').toLowerCase();
      const lockupContract = LOCKUP_CONTRACT.toLowerCase();
      
      // Determine if this is a lock or unlock event based on transfer direction
      let eventType: 'lockup_created' | 'unlock' | 'transfer' = 'transfer';
      
      if (to === lockupContract) {
        // Transfer TO lockup contract = lock (stake)
        eventType = 'lockup_created';
        console.log('[CDP Webhook] Detected lockup via Transfer event');
      } else if (from === lockupContract) {
        // Transfer FROM lockup contract = unlock (unstake)
        eventType = 'unlock';
        console.log('[CDP Webhook] Detected unlock via Transfer event');
      }
      
      return {
        type: eventType,
        data: {
          from: parameters.from,
          to: parameters.to,
          value: parameters.value,
          transactionHash,
          // For lockup_created and unlock, we won't have lockUpId from Transfer events
          // The frontend will need to refetch lockup details
        },
      };
    }
    
    console.log('[CDP Webhook] Event not handled:', { contractAddress, eventName });
    return null;
  } catch (error) {
    console.error('[CDP Webhook] Error parsing event:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get raw body for signature verification
    const bodyText = await request.text();
    const body = JSON.parse(bodyText);
    
    // Verify signature using X-Hook0-Signature header
    const allHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      allHeaders[key] = value;
    });
    
    const signatureHeader = request.headers.get('x-hook0-signature') || request.headers.get('X-Hook0-Signature');
    console.log('[CDP Webhook] Payload length:', bodyText.length);
    
    // Determine which secret to use based on event type
    // CDP payload has flat structure with event details at top level
    const eventName = body.event_name;
    const contractAddress = body.contract_address?.toLowerCase();
    
    console.log('[CDP Webhook] Event:', eventName, 'Contract:', contractAddress);
    
    let webhookSecret: string | undefined;
    
    if (contractAddress === LOCKUP_CONTRACT.toLowerCase()) {
      // LockUpCreated or Unlock event - use lockup secret
      webhookSecret = process.env.CDP_WEBHOOK_SECRET_LOCKUP;
      console.log('[CDP Webhook] Using lockup secret');
    } else if (contractAddress === HIGHER_TOKEN_ADDRESS.toLowerCase() && eventName === 'Transfer') {
      // Transfer event - use transfer secret
      webhookSecret = process.env.CDP_WEBHOOK_SECRET_TRANSFER;
      console.log('[CDP Webhook] Using transfer secret');
    }
    
    // Collect all secrets for verification (we'll try the specific one first if known)
    const allSecrets = [
      process.env.CDP_WEBHOOK_SECRET_LOCKUP,
      process.env.CDP_WEBHOOK_SECRET_TRANSFER,
    ].filter(Boolean) as string[];
    
    if (allSecrets.length === 0) {
      console.error('[CDP Webhook] No webhook secrets configured');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }
    
    // Verify signature - try specific secret first if we identified it, otherwise try all
    const secretsToTry = webhookSecret ? [webhookSecret] : allSecrets;
    if (!verifySignature(bodyText, signatureHeader, allHeaders, secretsToTry)) {
      console.error('[CDP Webhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    
    // Parse and handle event
    const parsedEvent = parseCDPEvent(body);
    if (parsedEvent) {
      console.log('[CDP Webhook] Processing event:', {
        type: parsedEvent.type,
        data: parsedEvent.data,
        eventName: body.event_name,
        contractAddress: body.contract_address
      });
      
      // Optimistic update for lockup_created events
      if (parsedEvent.type === 'lockup_created' && parsedEvent.data.title) {
        handleOptimisticLockupUpdate(parsedEvent.data).catch(error => {
          console.error('[CDP Webhook] Error in optimistic update:', error);
          // Don't fail the webhook if optimistic update fails
        });
      }
      
      // Handle unlock events
      if (parsedEvent.type === 'unlock' && parsedEvent.data.lockUpId) {
        handleUnlockUpdate(parsedEvent.data).catch(error => {
          console.error('[CDP Webhook] Error in unlock update:', error);
          // Don't fail the webhook if unlock update fails
        });
      }
    } else {
      console.log('[CDP Webhook] Event parsed but returned null - not processing');
    }
    
    return NextResponse.json({ success: true, message: 'Event received' });
  } catch (error) {
    console.error('[CDP Webhook] Error processing webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Handle optimistic update for lockup creation
 * Updates leaderboard_entries immediately when a new lockup is created
 */
async function handleOptimisticLockupUpdate(data: {
  lockUpId?: string | number;
  token?: string;
  receiver?: string;
  amount?: string | bigint;
  unlockTime?: number | string;
  title?: string;
}) {
  try {
    const castHash = data.title;
    if (!castHash || !isValidCastHash(castHash)) {
      console.log('[CDP Webhook] Invalid cast hash in lockup title, skipping optimistic update');
      return;
    }

    console.log('[CDP Webhook] Attempting optimistic update for cast:', castHash);

    // Check if cast exists in database
    let cast = await getHigherCast(castHash);
    
    // If not found, try to validate via Neynar and create entry
    if (!cast) {
      console.log('[CDP Webhook] Cast not in DB, validating via Neynar...');
      const castData = await getCastByHash(castHash);
      
      if (!castData || !castData.valid) {
        console.log('[CDP Webhook] Cast validation failed, skipping optimistic update');
        return;
      }

      // Create new entry with just this lockup
      cast = {
        castHash: castData.hash,
        creatorFid: castData.fid,
        creatorUsername: castData.username,
        creatorDisplayName: castData.displayName,
        creatorPfpUrl: castData.pfpUrl,
        castText: castData.castText,
        description: castData.description,
        castTimestamp: castData.timestamp,
        totalHigherStaked: '0',
        usdValue: null,
        rank: null,
        casterStakeLockupIds: [],
        casterStakeAmounts: [],
        casterStakeUnlockTimes: [],
        casterStakeUnlocked: [],
        supporterStakeLockupIds: [],
        supporterStakeAmounts: [],
        supporterStakeFids: [],
        supporterStakePfps: [],
        supporterStakeUnlockTimes: [],
        supporterStakeUnlocked: [],
        castState: 'valid',
      };
    }

    if (!cast) {
      console.log('[CDP Webhook] Cast is null, skipping optimistic update');
      return;
    }

    // Get current DB entry for merging existing data
    const currentDbEntry = await getHigherCast(castHash);
    const receiverAddress = data.receiver;
    if (!receiverAddress) {
      console.log('[CDP Webhook] No receiver address, skipping optimistic update');
      return;
    }

    const addressToFidMap = await getFidsFromAddresses([receiverAddress.toLowerCase()]);
    const receiverFid = addressToFidMap.get(receiverAddress.toLowerCase());
    
    if (!receiverFid) {
      console.log('[CDP Webhook] Could not map receiver address to FID, skipping optimistic update');
      return;
    }

    // Classify stake
    const isCasterStake = receiverFid === cast.creatorFid;
    const lockupId = typeof data.lockUpId === 'string' ? parseInt(data.lockUpId) : Number(data.lockUpId);
    const amount = typeof data.amount === 'string' ? data.amount : data.amount?.toString() || '0';
    const unlockTime = typeof data.unlockTime === 'string' ? parseInt(data.unlockTime) : Number(data.unlockTime || 0);
    const currentTime = Math.floor(Date.now() / 1000);

    // Only add if unlockTime hasn't passed
    if (unlockTime <= currentTime) {
      console.log('[CDP Webhook] Lockup already expired, skipping optimistic update');
      return;
    }

    // Update arrays
    let casterStakeLockupIds = [...cast.casterStakeLockupIds];
    let casterStakeAmounts = [...cast.casterStakeAmounts];
    let casterStakeUnlockTimes = [...cast.casterStakeUnlockTimes];
    let casterStakeUnlocked = [...(cast.casterStakeUnlocked || [])];
    let supporterStakeLockupIds = [...cast.supporterStakeLockupIds];
    let supporterStakeAmounts = [...cast.supporterStakeAmounts];
    let supporterStakeFids = [...cast.supporterStakeFids];
    let supporterStakePfps = [...cast.supporterStakePfps];
    let supporterStakeUnlockTimes = [...(cast.supporterStakeUnlockTimes || [])];
    let supporterStakeUnlocked = [...(cast.supporterStakeUnlocked || [])];

    if (isCasterStake) {
      // Add to caster stakes
      casterStakeLockupIds.push(lockupId);
      casterStakeAmounts.push(amount);
      casterStakeUnlockTimes.push(unlockTime);
      casterStakeUnlocked.push(false); // New lockup is not unlocked
    } else {
      // Add to supporter stakes
      supporterStakeLockupIds.push(lockupId);
      supporterStakeAmounts.push(amount);
      supporterStakeFids.push(receiverFid);
      supporterStakeUnlockTimes.push(unlockTime);
      supporterStakeUnlocked.push(false); // New lockup is not unlocked
      // PFP will be fetched below
    }

    // Calculate new total
    const totalCasterStaked = casterStakeAmounts.reduce((sum, amt) => sum + BigInt(amt), BigInt(0));
    const totalSupporterStaked = supporterStakeAmounts.reduce((sum, amt) => sum + BigInt(amt), BigInt(0));
    const totalStaked = Number(totalCasterStaked + totalSupporterStaked) / 1e18; // Convert from wei

    // Fetch PFPs for supporter FIDs that we don't have yet
    if (supporterStakeFids.length > 0) {
      try {
        const { NeynarAPIClient } = await import('@neynar/nodejs-sdk');
        const neynarApiKey = process.env.NEYNAR_API_KEY;
        if (neynarApiKey && neynarApiKey !== 'your_neynar_api_key_here') {
          const neynarClient = new NeynarAPIClient({ apiKey: neynarApiKey });
          // Get existing PFPs from database if available
          const currentDbEntry = await getHigherCast(castHash);
          const existingPfps = currentDbEntry?.supporterStakePfps || [];
          const existingFids = currentDbEntry?.supporterStakeFids || [];
          
          // Create a map of existing FID -> PFP
          const existingFidToPfp = new Map<number, string>();
          existingFids.forEach((fid: number, index: number) => {
            existingFidToPfp.set(fid, existingPfps[index] || '');
          });
          
          // Fetch PFPs for new supporter FIDs
          const newFids = supporterStakeFids.filter(fid => !existingFidToPfp.has(fid));
          if (newFids.length > 0) {
            const usersResponse = await neynarClient.fetchBulkUsers({ fids: newFids });
            for (const user of usersResponse.users) {
              existingFidToPfp.set(user.fid, user.pfp_url || '');
            }
          }
          
          // Build PFP array in the same order as supporterStakeFids
          supporterStakePfps = supporterStakeFids.map(fid => existingFidToPfp.get(fid) || '');
        }
      } catch (error) {
        console.error('[CDP Webhook] Error fetching supporter PFPs:', error);
        // Fallback to empty array if fetch fails
        supporterStakePfps = supporterStakeFids.map(() => '');
      }
    }

    // Build staker_fids array: [creator_fid, ...unique supporter_fids] (for backward compatibility)
    const stakerFids = new Set<number>([cast.creatorFid]);
    supporterStakeFids.forEach(fid => stakerFids.add(fid));

    // Update cast state to 'higher' if it has caster stakes
    const castState = casterStakeLockupIds.length > 0 ? 'higher' : cast.castState;

    // Update database
    await upsertHigherCast({
      castHash: cast.castHash,
      creatorFid: cast.creatorFid,
      creatorUsername: cast.creatorUsername,
      creatorDisplayName: cast.creatorDisplayName,
      creatorPfpUrl: cast.creatorPfpUrl,
      castText: cast.castText,
      description: cast.description,
      castTimestamp: cast.castTimestamp,
      totalHigherStaked: totalStaked, // Sum of caster_stake_amounts + supporter_stake_amounts
      usdValue: cast.usdValue ? parseFloat(cast.usdValue) : undefined,
      rank: cast.rank || undefined,
        casterStakeLockupIds,
        casterStakeAmounts,
        casterStakeUnlockTimes,
        casterStakeUnlocked,
        supporterStakeLockupIds,
        supporterStakeAmounts,
        supporterStakeFids,
        supporterStakePfps, // Array of PFP URLs corresponding to supporter_stake_fids
        supporterStakeUnlockTimes,
        supporterStakeUnlocked,
        stakerFids: Array.from(stakerFids), // For backward compatibility
        castState: castState as 'invalid' | 'valid' | 'higher',
    });

    console.log('[CDP Webhook] Optimistic update completed for cast:', castHash);
  } catch (error) {
    console.error('[CDP Webhook] Error in optimistic update:', error);
    // Don't throw - let cron job handle reconciliation
  }
}

/**
 * Handle unlock event
 * Updates leaderboard_entries when a lockup is unlocked
 */
async function handleUnlockUpdate(data: {
  lockUpId?: string | number;
  token?: string;
  receiver?: string;
}) {
  try {
    const lockupId = typeof data.lockUpId === 'string' ? parseInt(data.lockUpId) : Number(data.lockUpId);
    
    if (!lockupId || isNaN(lockupId)) {
      console.log('[CDP Webhook] Invalid lockup ID in unlock event, skipping update');
      return;
    }

    console.log('[CDP Webhook] Handling unlock event for lockup ID:', lockupId);

    // Find all casts that contain this lockup ID
    // We need to query the database to find which cast(s) have this lockup
    // Search for the lockup ID in both caster and supporter arrays
    const result = await sql`
      SELECT cast_hash
      FROM leaderboard_entries
      WHERE ${lockupId} = ANY(caster_stake_lockup_ids)
         OR ${lockupId} = ANY(supporter_stake_lockup_ids)
    `;

    if (result.rows.length === 0) {
      console.log('[CDP Webhook] No cast found with lockup ID:', lockupId);
      return;
    }

    // Update each cast that contains this lockup
    for (const row of result.rows) {
      const castHash = row.cast_hash;
      const cast = await getHigherCast(castHash);
      
      if (!cast) {
        console.log('[CDP Webhook] Cast not found for hash:', castHash);
        continue;
      }

      // Find the index of the lockup ID in either array
      const casterIndex = cast.casterStakeLockupIds.indexOf(lockupId);
      const supporterIndex = cast.supporterStakeLockupIds.indexOf(lockupId);

      if (casterIndex === -1 && supporterIndex === -1) {
        console.log('[CDP Webhook] Lockup ID not found in cast arrays:', lockupId);
        continue;
      }

      // Update the unlocked flag
      let casterStakeUnlocked = [...(cast.casterStakeUnlocked || [])];
      let supporterStakeUnlocked = [...(cast.supporterStakeUnlocked || [])];
      let castState = cast.castState;

      if (casterIndex !== -1) {
        // Ensure arrays are the same length
        while (casterStakeUnlocked.length < cast.casterStakeLockupIds.length) {
          casterStakeUnlocked.push(false);
        }
        casterStakeUnlocked[casterIndex] = true;
        
        // Check if all caster stakes are unlocked and expired
        const currentTime = Math.floor(Date.now() / 1000);
        const allCasterStakesExpired = cast.casterStakeLockupIds.every((id, idx) => {
          const unlockTime = cast.casterStakeUnlockTimes[idx] || 0;
          const unlocked = casterStakeUnlocked[idx] || false;
          return unlockTime <= currentTime && unlocked;
        });
        
        if (allCasterStakesExpired && cast.casterStakeLockupIds.length > 0) {
          castState = 'expired';
        }
      } else if (supporterIndex !== -1) {
        // Ensure arrays are the same length
        while (supporterStakeUnlocked.length < cast.supporterStakeLockupIds.length) {
          supporterStakeUnlocked.push(false);
        }
        supporterStakeUnlocked[supporterIndex] = true;
      }

      // Update the database
      await upsertHigherCast({
        castHash: cast.castHash,
        creatorFid: cast.creatorFid,
        creatorUsername: cast.creatorUsername,
        creatorDisplayName: cast.creatorDisplayName,
        creatorPfpUrl: cast.creatorPfpUrl,
        castText: cast.castText,
        description: cast.description,
        castTimestamp: cast.castTimestamp,
        totalHigherStaked: parseFloat(cast.totalHigherStaked),
        usdValue: cast.usdValue ? parseFloat(cast.usdValue) : undefined,
        rank: cast.rank || undefined,
        casterStakeLockupIds: cast.casterStakeLockupIds,
        casterStakeAmounts: cast.casterStakeAmounts,
        casterStakeUnlockTimes: cast.casterStakeUnlockTimes,
        casterStakeUnlocked,
        supporterStakeLockupIds: cast.supporterStakeLockupIds,
        supporterStakeAmounts: cast.supporterStakeAmounts,
        supporterStakeFids: cast.supporterStakeFids,
        supporterStakePfps: cast.supporterStakePfps,
        supporterStakeUnlockTimes: cast.supporterStakeUnlockTimes || [],
        supporterStakeUnlocked,
        castState: castState as 'invalid' | 'valid' | 'higher' | 'expired',
      });

      console.log('[CDP Webhook] Unlock update completed for cast:', castHash, 'lockup:', lockupId);
    }
  } catch (error) {
    console.error('[CDP Webhook] Error in unlock update:', error);
    // Don't throw - let cron job handle reconciliation
  }
}


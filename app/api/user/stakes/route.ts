import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { formatUnits } from 'viem';

// Force Node.js runtime
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LockupDetail {
  lockupId: string;
  amount: string;
  amountFormatted: string;
  unlockTime: number;
  receiver: string;
  title: string;
  castHash: string;
  castText: string;
  description: string;
  castState: 'invalid' | 'valid' | 'higher' | 'expired';
  isCasterStake: boolean;
}

/**
 * GET /api/user/stakes?fid={fid}
 * 
 * Fetches all lockups for a user's verified wallet addresses from the database.
 * Returns lockups where unlocked = false (so users can unstake expired ones).
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const fidParam = searchParams.get('fid');

    if (!fidParam) {
      return NextResponse.json(
        { error: 'FID is required' },
        { status: 400 }
      );
    }

    const fid = parseInt(fidParam, 10);

    if (isNaN(fid)) {
      return NextResponse.json(
        { error: 'Invalid FID' },
        { status: 400 }
      );
    }

    // Fetch user profile from Neynar to get verified addresses
    const neynarApiKey = process.env.NEYNAR_API_KEY;

    if (!neynarApiKey || neynarApiKey === 'your_neynar_api_key_here') {
      console.warn('[Stakes API] Neynar API key not configured');
      return NextResponse.json({
        lockups: [],
        error: 'Neynar API key not configured',
      });
    }

    // Lazy import Neynar SDK
    const { NeynarAPIClient } = await import('@neynar/nodejs-sdk');
    const neynarClient = new NeynarAPIClient({ apiKey: neynarApiKey });

    const userResponse = await neynarClient.fetchBulkUsers({ fids: [fid] });
    const user = userResponse.users[0];

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Get all verified Ethereum addresses
    const verifiedAddresses = user.verified_addresses?.eth_addresses || [];
    
    console.log(`[Stakes API] User ${fid} has ${verifiedAddresses.length} verified addresses`);

    if (verifiedAddresses.length === 0) {
      return NextResponse.json({
        lockups: [],
        message: 'No verified addresses found',
      });
    }

    // Normalize addresses to lowercase for comparison
    const normalizedAddresses = verifiedAddresses.map(addr => addr.toLowerCase());

    // Query leaderboard_entries to find all casts with lockups for these addresses
    // We need to check both caster and supporter stakes
    // Since we store receiver addresses in the lockup contract, we need to match
    // against the receiver addresses stored in the database
    
    // For now, we'll query all casts and filter in memory
    // This could be optimized with a better database structure, but for now it works
    const allCasts = await sql`
      SELECT 
        cast_hash,
        creator_fid,
        cast_text,
        description,
        cast_state,
        caster_stake_lockup_ids,
        caster_stake_amounts,
        caster_stake_unlock_times,
        caster_stake_unlocked,
        supporter_stake_lockup_ids,
        supporter_stake_amounts,
        supporter_stake_unlock_times,
        supporter_stake_unlocked,
        supporter_stake_fids
      FROM leaderboard_entries
      WHERE array_length(caster_stake_lockup_ids, 1) > 0
         OR array_length(supporter_stake_lockup_ids, 1) > 0
    `;

    const lockups: LockupDetail[] = [];

    // For each cast, check if any lockups match the user's addresses
    // We need to map lockup IDs to receiver addresses
    // Since we don't store receiver addresses directly in the DB, we'll need to
    // infer from the stake type (caster vs supporter) and the creator FID
    
    // Actually, we can't directly match receiver addresses from the DB alone
    // We need to check the lockup contract or use the webhook data
    // For now, let's use a different approach: query casts where the user is either
    // the creator (for caster stakes) or in supporter_stake_fids (for supporter stakes)
    
    // Get casts where user is creator (caster stakes) or supporter
    const userCasts = await sql`
      SELECT 
        cast_hash,
        creator_fid,
        cast_text,
        description,
        cast_state,
        caster_stake_lockup_ids,
        caster_stake_amounts,
        caster_stake_unlock_times,
        caster_stake_unlocked,
        supporter_stake_lockup_ids,
        supporter_stake_amounts,
        supporter_stake_unlock_times,
        supporter_stake_unlocked,
        supporter_stake_fids
      FROM leaderboard_entries
      WHERE creator_fid = ${fid}
         OR ${fid} = ANY(supporter_stake_fids)
    `;

    // Map verified addresses to FID for quick lookup
    const addressToFidMap = new Map<string, number>();
    verifiedAddresses.forEach(addr => {
      addressToFidMap.set(addr.toLowerCase(), fid);
    });

    // Process each cast
    for (const row of userCasts.rows) {
      const castHash = row.cast_hash;
      const creatorFid = row.creator_fid;
      const castText = row.cast_text;
      const description = row.description;
      const castState = row.cast_state || 'higher';
      
      const casterStakeLockupIds = row.caster_stake_lockup_ids || [];
      const casterStakeAmounts = row.caster_stake_amounts || [];
      const casterStakeUnlockTimes = row.caster_stake_unlock_times || [];
      const casterStakeUnlocked = row.caster_stake_unlocked || [];
      
      const supporterStakeLockupIds = row.supporter_stake_lockup_ids || [];
      const supporterStakeAmounts = row.supporter_stake_amounts || [];
      const supporterStakeUnlockTimes = row.supporter_stake_unlock_times || [];
      const supporterStakeUnlocked = row.supporter_stake_unlocked || [];
      const supporterStakeFids = row.supporter_stake_fids || [];

      // Process caster stakes (if user is creator)
      if (creatorFid === fid) {
        for (let i = 0; i < casterStakeLockupIds.length; i++) {
          const unlocked = casterStakeUnlocked[i] || false;
          
          // Only include if not unlocked (so users can unstake expired ones)
          if (!unlocked) {
            const lockupId = casterStakeLockupIds[i];
            const amount = casterStakeAmounts[i]?.toString() || '0';
            const unlockTime = casterStakeUnlockTimes[i] || 0;
            
            // We need to get the receiver address from the lockup contract
            // For now, we'll use a placeholder - the actual receiver should be
            // fetched from the contract or stored in the DB
            // Since it's a caster stake, the receiver should be one of the user's verified addresses
            // We'll use the first verified address as a placeholder
            const receiver = verifiedAddresses[0] || '';
            
            lockups.push({
              lockupId: lockupId.toString(),
              amount,
              amountFormatted: parseFloat(formatUnits(BigInt(amount), 18)).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }),
              unlockTime,
              receiver,
              title: castHash, // Cast hash is stored in title
              castHash,
              castText,
              description,
              castState,
              isCasterStake: true,
            });
          }
        }
      }

      // Process supporter stakes (if user is in supporter_stake_fids)
      const supporterIndex = supporterStakeFids.indexOf(fid);
      if (supporterIndex !== -1) {
        // Find all lockups for this supporter FID
        // Since supporter_stake_fids is an array, we need to find all indices where fid matches
        for (let i = 0; i < supporterStakeLockupIds.length; i++) {
          // Check if this lockup belongs to the user
          // We need to match by index - supporter_stake_fids[i] should match fid
          if (i < supporterStakeFids.length && supporterStakeFids[i] === fid) {
            const unlocked = supporterStakeUnlocked[i] || false;
            
            // Only include if not unlocked
            if (!unlocked) {
              const lockupId = supporterStakeLockupIds[i];
              const amount = supporterStakeAmounts[i]?.toString() || '0';
              const unlockTime = supporterStakeUnlockTimes[i] || 0;
              
              // Use the first verified address as receiver placeholder
              const receiver = verifiedAddresses[0] || '';
              
              lockups.push({
                lockupId: lockupId.toString(),
                amount,
                amountFormatted: parseFloat(formatUnits(BigInt(amount), 18)).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }),
                unlockTime,
                receiver,
                title: castHash, // Cast hash is stored in title
                castHash,
                castText,
                description,
                castState,
                isCasterStake: false,
              });
            }
          }
        }
      }
    }

    // Sort by unlock time (earliest first)
    lockups.sort((a, b) => a.unlockTime - b.unlockTime);

    console.log(`[Stakes API] Found ${lockups.length} lockups for user ${fid}`);

    return NextResponse.json({
      lockups,
    });

  } catch (error: any) {
    console.error('[Stakes API] Error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error.message || String(error)
      },
      { status: 500 }
    );
  }
}


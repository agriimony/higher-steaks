import { NextRequest, NextResponse } from 'next/server';
import { getHigherCast } from '@/lib/services/db-service';
import { isValidCastHash } from '@/lib/cast-helpers';
import { calculateWeightedStake } from '@/lib/supporter-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENTRIES_PER_PAGE = 20;

export async function GET(
  request: NextRequest,
  { params }: { params: { hash: string } }
) {
  try {
    const hash = params.hash;

    if (!hash) {
      return NextResponse.json(
        { error: 'Cast hash is required' },
        { status: 400 }
      );
    }

    // Normalize hash format
    let castHash = hash;
    if (!castHash.startsWith('0x') && /^[a-fA-F0-9]+$/.test(castHash)) {
      castHash = '0x' + castHash;
    }

    // Check if it's a valid hash format
    if (!isValidCastHash(castHash)) {
      return NextResponse.json(
        { error: 'Invalid cast hash format' },
        { status: 400 }
      );
    }

    // Get pagination params
    const pageParam = request.nextUrl.searchParams.get('page');
    const page = pageParam ? Math.max(1, parseInt(pageParam, 10)) : 1;
    const userFidParam = request.nextUrl.searchParams.get('userFid');
    const userFid = userFidParam ? parseInt(userFidParam, 10) : null;

    // Get cast from database
    const castData = await getHigherCast(castHash);

    if (!castData) {
      return NextResponse.json(
        { error: 'Higher cast not found' },
        { status: 404 }
      );
    }

    const currentTime = Math.floor(Date.now() / 1000);

    // Calculate weighted caster stake (ALL stakes, including unlocked/expired)
    const casterStakeLockTimes = castData.casterStakeLockTimes || [];
    const casterStakeUnlockTimes = castData.casterStakeUnlockTimes || [];
    const casterStakeAmounts = castData.casterStakeAmounts || [];
    
    let totalCasterWeightedStake = 0;
    for (let i = 0; i < casterStakeAmounts.length; i++) {
      const amount = BigInt(casterStakeAmounts[i] || '0');
      const lockTime = casterStakeLockTimes[i] || 0;
      const unlockTime = casterStakeUnlockTimes[i] || 0;
      
      if (lockTime > 0 && unlockTime > 0 && amount > 0) {
        const weighted = calculateWeightedStake(amount, lockTime, unlockTime, currentTime);
        totalCasterWeightedStake += weighted;
      }
    }

    // Calculate weighted supporter stakes per FID (ALL stakes, including unlocked/expired)
    const supporterStakeLockTimes = castData.supporterStakeLockTimes || [];
    const supporterStakeUnlockTimes = castData.supporterStakeUnlockTimes || [];
    const supporterStakeAmounts = castData.supporterStakeAmounts || [];
    const supporterStakeFids = castData.supporterStakeFids || [];
    const supporterStakePfps = castData.supporterStakePfps || [];

    // Map to aggregate by FID
    const supporterWeightedStakesMap = new Map<number, {
      fid: number;
      pfp: string;
      weightedStake: number;
    }>();

    for (let i = 0; i < supporterStakeAmounts.length; i++) {
      const amount = BigInt(supporterStakeAmounts[i] || '0');
      const lockTime = supporterStakeLockTimes[i] || 0;
      const unlockTime = supporterStakeUnlockTimes[i] || 0;
      const fid = supporterStakeFids[i] || 0;
      const pfp = supporterStakePfps[i] || '';

      if (lockTime > 0 && unlockTime > 0 && amount > 0 && fid > 0) {
        const weighted = calculateWeightedStake(amount, lockTime, unlockTime, currentTime);
        
        if (supporterWeightedStakesMap.has(fid)) {
          const existing = supporterWeightedStakesMap.get(fid)!;
          existing.weightedStake += weighted;
        } else {
          supporterWeightedStakesMap.set(fid, {
            fid,
            pfp,
            weightedStake: weighted,
          });
        }
      }
    }

    // Convert to array and sort
    let supporters = Array.from(supporterWeightedStakesMap.values());

    // Fetch usernames from Neynar API
    const uniqueFids = supporters.map(s => s.fid);
    const usernameMap = new Map<number, { username: string; displayName: string }>();

    if (uniqueFids.length > 0) {
      try {
        const neynarApiKey = process.env.NEYNAR_API_KEY;
        if (neynarApiKey && neynarApiKey !== 'your_neynar_api_key_here') {
          const { NeynarAPIClient } = await import('@neynar/nodejs-sdk');
          const neynarClient = new NeynarAPIClient({ apiKey: neynarApiKey });
          
          // Fetch in batches (Neynar supports up to 100 FIDs per request)
          const batchSize = 100;
          for (let i = 0; i < uniqueFids.length; i += batchSize) {
            const batch = uniqueFids.slice(i, i + batchSize);
            try {
              const userResponse = await neynarClient.fetchBulkUsers({ fids: batch });
              for (const user of userResponse.users) {
                usernameMap.set(user.fid, {
                  username: user.username,
                  displayName: user.display_name || user.username,
                });
              }
            } catch (neynarError) {
              console.error('[Leaderboard API] Error fetching users from Neynar:', neynarError);
              // Continue with other batches even if one fails
            }
          }
        }
      } catch (neynarError) {
        console.error('[Leaderboard API] Error initializing Neynar client:', neynarError);
        // Continue without usernames
      }
    }

    // Add usernames to supporters
    supporters = supporters.map(supporter => ({
      ...supporter,
      username: usernameMap.get(supporter.fid)?.username || `fid-${supporter.fid}`,
      displayName: usernameMap.get(supporter.fid)?.displayName || `fid-${supporter.fid}`,
    }));

    // Sort: connected user first (if exists), then descending by weighted stake
    supporters.sort((a, b) => {
      if (userFid !== null) {
        if (a.fid === userFid && b.fid !== userFid) return -1;
        if (a.fid !== userFid && b.fid === userFid) return 1;
      }
      return b.weightedStake - a.weightedStake;
    });

    // Pagination
    const totalSupporters = supporters.length;
    const totalPages = Math.max(1, Math.ceil(totalSupporters / ENTRIES_PER_PAGE));
    const startIndex = (page - 1) * ENTRIES_PER_PAGE;
    const endIndex = startIndex + ENTRIES_PER_PAGE;
    const paginatedSupporters = supporters.slice(startIndex, endIndex);

    // Add ranks (1-based, accounting for pagination)
    const supportersWithRanks = paginatedSupporters.map((supporter, index) => ({
      ...supporter,
      rank: startIndex + index + 1,
    }));

    return NextResponse.json({
      caster: {
        fid: castData.creatorFid,
        username: castData.creatorUsername,
        displayName: castData.creatorDisplayName,
        pfpUrl: castData.creatorPfpUrl,
        weightedStake: totalCasterWeightedStake,
      },
      supporters: supportersWithRanks,
      totalPages,
      currentPage: page,
      totalSupporters,
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (error: any) {
    console.error('[Leaderboard API] Error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        message: error.message || String(error)
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}


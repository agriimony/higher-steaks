import { NextRequest, NextResponse } from 'next/server';
import { getHigherCast } from '@/lib/services/db-service';
import { isValidCastHash } from '@/lib/cast-helpers';
import { aggregateSupporterStakes } from '@/lib/supporter-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

    console.log('[Cast API] Fetching cast:', hash);

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

    // Get cast from database (primary source of truth)
    const castData = await getHigherCast(castHash);
    console.log('[Cast API] Cast data:', castData);

    if (!castData) {
      return NextResponse.json(
        { error: 'Higher cast not found' },
        { status: 404 }
      );
    }

    const currentTime = Math.floor(Date.now() / 1000);

    // Filter valid caster stakes (not unlocked and currentTime < unlockTime)
    const casterStakeUnlocked = castData.casterStakeUnlocked || [];
    const validCasterStakes = castData.casterStakeLockupIds
      .map((lockupId, index) => ({
        lockupId,
        amount: castData.casterStakeAmounts[index] || '0',
        unlockTime: castData.casterStakeUnlockTimes[index] || 0,
        unlocked: casterStakeUnlocked[index] || false,
      }))
      .filter(stake => !stake.unlocked && stake.unlockTime > currentTime);

    // Calculate min and max caster unlock times
    const validCasterUnlockTimes = validCasterStakes.map(s => s.unlockTime);
    const minCasterUnlockTime = validCasterUnlockTimes.length > 0
      ? Math.min(...validCasterUnlockTimes)
      : 0;
    const maxCasterUnlockTime = validCasterUnlockTimes.length > 0
      ? Math.max(...validCasterUnlockTimes)
      : 0;

    // Calculate total caster staked (only valid stakes)
    const totalCasterStaked = validCasterStakes.reduce((sum, stake) => {
      return sum + BigInt(stake.amount);
    }, BigInt(0)).toString();

    // Filter valid supporter stakes using unlock times
    // Supporter stakes are valid if:
    // 1. currentTime < unlockTime (not expired)
    // 2. unlockTime > minCasterUnlockTime (unlocks after earliest caster stake)
    const supporterStakeUnlockTimes = castData.supporterStakeUnlockTimes || [];
    const supporterStakeUnlocked = castData.supporterStakeUnlocked || [];
    
    // Filter supporter stakes by unlock time and unlocked status
    const validSupporterStakeIndices: number[] = [];
    for (let i = 0; i < castData.supporterStakeLockupIds.length; i++) {
      const unlockTime = supporterStakeUnlockTimes[i] || 0;
      const unlocked = supporterStakeUnlocked[i] || false;
      
      // Valid if: not unlocked, not expired, and unlocks after min caster unlock time
      if (!unlocked && unlockTime > currentTime && unlockTime > minCasterUnlockTime) {
        validSupporterStakeIndices.push(i);
      }
    }
    
    // Build filtered arrays for aggregation
    const validSupporterStakeFids = validSupporterStakeIndices.map(i => castData.supporterStakeFids[i] || 0);
    const validSupporterStakeAmounts = validSupporterStakeIndices.map(i => castData.supporterStakeAmounts[i] || '0');
    const validSupporterStakePfps = validSupporterStakeIndices.map(i => castData.supporterStakePfps[i] || '');
    
    // Aggregate supporter stakes per FID (only valid ones)
    const aggregatedSupporterStakes = aggregateSupporterStakes(
      validSupporterStakeFids,
      validSupporterStakeAmounts,
      validSupporterStakePfps
    );
    
    const validSupporterStakes = aggregatedSupporterStakes;

    // Calculate total supporter staked
    const totalSupporterStaked = validSupporterStakes.reduce((sum, stake) => {
      return sum + BigInt(stake.totalAmount);
    }, BigInt(0)).toString();

    // Get connected user's stake if userFid is provided
    const userFidParam = request.nextUrl.searchParams.get('userFid');
    const userFid = userFidParam ? parseInt(userFidParam, 10) : null;
    const connectedUserStake = userFid
      ? validSupporterStakes.find(stake => stake.fid === userFid)
      : undefined;

    return NextResponse.json({
      hash: castData.castHash,
      fid: castData.creatorFid,
      username: castData.creatorUsername,
      displayName: castData.creatorDisplayName,
      pfpUrl: castData.creatorPfpUrl,
      castText: castData.castText,
      description: castData.description,
      timestamp: castData.castTimestamp,
      state: castData.castState,
      totalHigherStaked: castData.totalHigherStaked,
      usdValue: castData.usdValue ? parseFloat(castData.usdValue) : null,
      rank: castData.rank,
      maxCasterUnlockTime,
      minCasterUnlockTime,
      totalCasterStaked,
      totalSupporterStaked,
      casterStakes: validCasterStakes.map(stake => ({
        lockupId: stake.lockupId,
        amount: stake.amount,
        unlockTime: stake.unlockTime,
      })),
      supporterStakes: validSupporterStakes.map(stake => ({
        fid: stake.fid,
        pfp: stake.pfp,
        totalAmount: stake.totalAmount,
      })),
      connectedUserStake: connectedUserStake ? {
        fid: connectedUserStake.fid,
        totalAmount: connectedUserStake.totalAmount,
      } : undefined,
    });

  } catch (error: any) {
    console.error('[Cast API] Error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        message: error.message || String(error)
      },
      { status: 500 }
    );
  }
}


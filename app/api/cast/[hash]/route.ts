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

    if (!castData) {
      return NextResponse.json(
        { error: 'Higher cast not found' },
        { status: 404 }
      );
    }

    const currentTime = Math.floor(Date.now() / 1000);

    // Filter valid caster stakes (currentTime < unlockTime)
    const validCasterStakes = castData.casterStakeLockupIds
      .map((lockupId, index) => ({
        lockupId,
        amount: castData.casterStakeAmounts[index] || '0',
        unlockTime: castData.casterStakeUnlockTimes[index] || 0,
      }))
      .filter(stake => stake.unlockTime > currentTime);

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

    // Aggregate supporter stakes per FID
    const aggregatedSupporterStakes = aggregateSupporterStakes(
      castData.supporterStakeFids,
      castData.supporterStakeAmounts,
      castData.supporterStakePfps
    );

    // Note: We don't have unlock times for supporter stakes in the database yet
    // For now, we'll include all supporter stakes. This will be enhanced when
    // we add supporter_stake_unlock_times column to filter by both conditions:
    // 1. currentTime < unlockTime
    // 2. unlockTime > minCasterUnlockTime
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


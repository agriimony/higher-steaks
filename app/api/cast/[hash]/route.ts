import { NextRequest, NextResponse } from 'next/server';
import { getHigherCast } from '@/lib/services/db-service';
import { isValidCastHash } from '@/lib/cast-helpers';

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

    // Filter valid caster stakes: !unlocked only (no expiry check)
    const casterStakeUnlocked = castData.casterStakeUnlocked || [];
    const validCasterStakes = castData.casterStakeLockupIds
      .map((lockupId, index) => ({
        lockupId,
        amount: castData.casterStakeAmounts[index] || '0',
        unlockTime: castData.casterStakeUnlockTimes[index] || 0,
        unlocked: casterStakeUnlocked[index] || false,
      }))
      .filter(stake => !stake.unlocked);

    // Calculate min and max caster unlock times from valid stakes
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

    // Filter + aggregate valid supporter stakes (no PFPs stored in DB)
    // Rules:
    // - active = !unlocked (no expiry check)
    // - valid = unlockTime matches at least one caster unlockTime (ALL caster unlockTimes, not just valid ones)
    const supporterStakeUnlockTimes = castData.supporterStakeUnlockTimes || [];
    const supporterStakeUnlocked = castData.supporterStakeUnlocked || [];
    const supporterStakeFids = castData.supporterStakeFids || [];
    const supporterStakeAmounts = castData.supporterStakeAmounts || [];

    // Build Set of ALL caster unlockTimes (regardless of unlocked status or validity)
    const casterUnlockSet = new Set(
      castData.casterStakeUnlockTimes.filter((t: any) => typeof t === 'number' && Number.isFinite(t))
    );
    const supporterTotals = new Map<number, bigint>();

    for (let i = 0; i < castData.supporterStakeLockupIds.length; i++) {
      const unlocked = supporterStakeUnlocked[i] || false;
      if (unlocked) continue;

      const unlockTime = supporterStakeUnlockTimes[i] || 0;
      if (!casterUnlockSet.has(unlockTime)) continue;

      const fid = Number(supporterStakeFids[i] || 0);
      if (!Number.isFinite(fid) || fid <= 0) continue;

      const rawAmount = String(supporterStakeAmounts[i] || '0');
      let amountWei: bigint;
      try {
        amountWei = BigInt(rawAmount);
      } catch {
        continue;
      }
      if (amountWei <= 0n) continue;

      supporterTotals.set(fid, (supporterTotals.get(fid) || 0n) + amountWei);
    }

    const totalUniqueSupporters = supporterTotals.size;

    // Sorted top 10 supporters by total active stake (wei)
    const topSupporters = Array.from(supporterTotals.entries())
      .sort((a, b) => (a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0))
      .slice(0, 10)
      .map(([fid, totalAmount]) => ({
        fid,
        totalAmount: totalAmount.toString(),
      }));

    const totalSupporterStaked = Array.from(supporterTotals.values())
      .reduce((sum, v) => sum + v, 0n)
      .toString();

    // Get connected user's stake if userFid is provided
    const userFidParam = request.nextUrl.searchParams.get('userFid');
    const userFid = userFidParam ? parseInt(userFidParam, 10) : null;
    const connectedUserStake = userFid && supporterTotals.has(userFid)
      ? { fid: userFid, totalAmount: (supporterTotals.get(userFid) || 0n).toString() }
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
      topSupporters,
      totalUniqueSupporters,
      connectedUserStake,
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


import { NextRequest, NextResponse } from 'next/server';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { fetchAllLatestResults } from '@/lib/dune';
import { getHigherCast } from '@/lib/services/db-service';
import { buildInFilter, normalizeAddr, normalizeHash, convertAmount } from '../stakes/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QUERY_ID = 6214515;
const COLUMNS = ['sender','lockTime','lockUpId','title','amount','receiver','unlockTime','unlocked'];

export async function GET(req: NextRequest) {
  try {
    const search = req.nextUrl.searchParams;
    const fidParam = search.get('fid');

    if (!fidParam) {
      return NextResponse.json({ error: 'fid required' }, { status: 400 });
    }
    const fid = parseInt(fidParam, 10);
    if (isNaN(fid)) {
      return NextResponse.json({ error: 'invalid fid' }, { status: 400 });
    }

    // Resolve wallets via Neynar (custody + verified)
    const neynarApiKey = process.env.NEYNAR_API_KEY;
    if (!neynarApiKey) {
      return NextResponse.json({ error: 'NEYNAR_API_KEY not configured' }, { status: 500 });
    }
    const neynar = new NeynarAPIClient({ apiKey: neynarApiKey });
    const users = await neynar.fetchBulkUsers({ fids: [fid] });
    const user = users.users?.[0];
    if (!user) {
      return NextResponse.json({
        totalUserStaked: '0',
        totalCasterStaked: '0',
        totalSupporterStaked: '0',
        totalBuildersSupported: 0,
        topSupportedFids: [],
      });
    }
    const walletsSet = new Set<string>();
    if (user.custody_address) walletsSet.add(normalizeAddr(user.custody_address)!);
    for (const ea of (user.verified_addresses?.eth_addresses ?? [])) {
      const n = normalizeAddr(ea);
      if (n) walletsSet.add(n);
    }
    if (walletsSet.size === 0) {
      return NextResponse.json({
        totalUserStaked: '0',
        totalCasterStaked: '0',
        totalSupporterStaked: '0',
        totalBuildersSupported: 0,
        topSupportedFids: [],
      });
    }

    const addresses = Array.from(walletsSet);
    const filters = buildInFilter(addresses);

    // Fetch from Dune
    const rows = await fetchAllLatestResults(QUERY_ID, {
      columns: COLUMNS,
      limit: 1000, // Get all user's lockups
      filters,
    });

    const castHashes = Array.from(new Set(
      rows
        .map((r: any) => normalizeHash(String(r.title || '')))
        .filter((h): h is string => Boolean(h))
    ));
    const castCache = new Map<string, any>();
    await Promise.all(
      castHashes.map(async hash => {
        const data = await getHigherCast(hash);
        castCache.set(hash, data);
      })
    );

    let totalCasterStaked = BigInt(0);
    let totalSupporterStaked = BigInt(0);
    const supportedFidsMap = new Map<number, { fid: number; totalAmount: bigint; castHash: string }>();

    // Process each lockup
    for (const r of rows) {
      const lockUpId = Number(r.lockUpId);
      const castHash = normalizeHash(String(r.title || ''));
      let overrideAmount = convertAmount(r.amount ?? '0');
      let unlocked = Boolean(r.unlocked);
      let stakeType: 'caster' | 'supporter' | null = null;

      if (castHash) {
        const cast = castCache.get(castHash);
        if (cast) {
          const casterIdx = cast.casterStakeLockupIds?.findIndex((id: number) => Number(id) === lockUpId) ?? -1;
          if (casterIdx !== -1) {
            stakeType = 'caster';
            unlocked = cast.casterStakeUnlocked?.[casterIdx] ?? unlocked;
            const raw = cast.casterStakeAmounts?.[casterIdx];
            if (raw !== undefined) {
              overrideAmount = convertAmount(raw);
            }
          } else {
            const supporterIdx = cast.supporterStakeLockupIds?.findIndex((id: number) => Number(id) === lockUpId) ?? -1;
            if (supporterIdx !== -1) {
              stakeType = 'supporter';
              unlocked = cast.supporterStakeUnlocked?.[supporterIdx] ?? unlocked;
              const raw = cast.supporterStakeAmounts?.[supporterIdx];
              if (raw !== undefined) {
                overrideAmount = convertAmount(raw);
              }
            }
          }
        }
      }

      // Skip unlocked stakes
      if (unlocked) continue;

      // convertAmount returns token units (not wei), so convert to wei for BigInt math
      const amountNum = parseFloat(overrideAmount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) continue;
      const amountBigInt = BigInt(Math.floor(amountNum * 1e18));

      if (stakeType === 'caster') {
        totalCasterStaked += amountBigInt;
      } else if (stakeType === 'supporter' && castHash) {
        totalSupporterStaked += amountBigInt;
        
        // Get creator FID from cast
        const cast = castCache.get(castHash);
        if (cast && cast.creatorFid) {
          const creatorFid = cast.creatorFid;
          const existing = supportedFidsMap.get(creatorFid);
          if (existing) {
            existing.totalAmount += amountBigInt;
          } else {
            supportedFidsMap.set(creatorFid, {
              fid: creatorFid,
              totalAmount: amountBigInt,
              castHash,
            });
          }
        }
      }
    }

    // Convert from wei to number
    const totalCasterStakedNum = Number(totalCasterStaked) / 1e18;
    const totalSupporterStakedNum = Number(totalSupporterStaked) / 1e18;
    const totalUserStakedNum = totalCasterStakedNum + totalSupporterStakedNum;

    // Get top supported fids (sorted by total amount)
    const topSupportedFidsData = Array.from(supportedFidsMap.values())
      .sort((a, b) => {
        if (a.totalAmount > b.totalAmount) return -1;
        if (a.totalAmount < b.totalAmount) return 1;
        return 0;
      })
      .slice(0, 10); // Top 10

    // Fetch user profiles for top supported fids
    const topSupportedFids = [];
    if (topSupportedFidsData.length > 0) {
      const fidsToFetch = topSupportedFidsData.map(d => d.fid);
      const userProfiles = await neynar.fetchBulkUsers({ fids: fidsToFetch });
      const profileMap = new Map(
        userProfiles.users.map(u => [u.fid, u])
      );

      for (const data of topSupportedFidsData) {
        const profile = profileMap.get(data.fid);
        topSupportedFids.push({
          fid: data.fid,
          username: profile?.username || `user-${data.fid}`,
          displayName: profile?.display_name || profile?.username || `User ${data.fid}`,
          pfpUrl: profile?.pfp_url || '',
          totalAmount: (Number(data.totalAmount) / 1e18).toString(),
        });
      }
    }

    return NextResponse.json({
      totalUserStaked: totalUserStakedNum.toString(),
      totalCasterStaked: totalCasterStakedNum.toString(),
      totalSupporterStaked: totalSupporterStakedNum.toString(),
      totalBuildersSupported: supportedFidsMap.size,
      topSupportedFids,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    console.error('[User Stats API] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}


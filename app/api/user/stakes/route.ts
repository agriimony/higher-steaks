import { NextRequest, NextResponse } from 'next/server';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { fetchAllLatestResults } from '@/lib/dune';
import { getHigherCast, HigherCastData } from '@/lib/services/db-service';
import { buildInFilter, normalizeAddr, normalizeHash, serverSort, convertAmount } from './utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QUERY_ID = 6214515;
const COLUMNS = ['sender','lockTime','lockUpId','title','amount','receiver','unlockTime','unlocked'];

export async function GET(req: NextRequest) {
  try {
    const search = req.nextUrl.searchParams;
    const fidParam = search.get('fid');
    const connectedAddress = search.get('connectedAddress') || undefined;
    const offsetParam = search.get('offset') || '0';
    const offset = Math.max(0, parseInt(offsetParam, 10) || 0);
    const pageSize = 3;

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
      return NextResponse.json({ items: [], nextOffset: null });
    }
    const walletsSet = new Set<string>();
    if (user.custody_address) walletsSet.add(normalizeAddr(user.custody_address)!);
    for (const ea of (user.verified_addresses?.eth_addresses ?? [])) {
      const n = normalizeAddr(ea);
      if (n) walletsSet.add(n);
    }
    if (walletsSet.size === 0) {
      return NextResponse.json({ items: [], nextOffset: null });
    }

    const addresses = Array.from(walletsSet);
    const filters = buildInFilter(addresses);

    // Fetch from Dune; get a reasonable chunk to sort properly server-side
    const rows = await fetchAllLatestResults(QUERY_ID, {
      columns: COLUMNS,
      limit: 1000, // fetch a window; server-side sort then page
      filters,
    });

    const castHashes = Array.from(new Set(
      rows
        .map((r: any) => normalizeHash(String(r.title || '')))
        .filter((h): h is string => Boolean(h))
    ));
    const castCache = new Map<string, HigherCastData | null>();
    await Promise.all(
      castHashes.map(async hash => {
        const data = await getHigherCast(hash);
        castCache.set(hash, data);
      })
    );

    const normalized = rows.map((r: any) => {
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

      return {
        lockUpId,
        castHash,
        sender: String(r.sender || '').toLowerCase(),
        receiver: String(r.receiver || '').toLowerCase(),
        amount: overrideAmount,
        unlockTime: Number(r.unlockTime || 0),
        lockTime: Number(r.lockTime || 0),
        unlocked,
        title: castHash || String(r.title || ''),
        stakeType,
      };
    });

    const totalActiveStaked = normalized.reduce((sum, item) => {
      if (item.unlocked) return sum;
      const num = Number(item.amount);
      return sum + (Number.isFinite(num) ? num : 0);
    }, 0);

    const sorted = serverSort(normalized, connectedAddress);
    const paged = sorted.slice(offset, offset + pageSize);
    const nextOffset = offset + pageSize < sorted.length ? offset + pageSize : null;

    return NextResponse.json({
      items: paged,
      nextOffset,
      totals: {
        totalStaked: totalActiveStaked.toString(),
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}



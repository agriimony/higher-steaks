import { NextRequest, NextResponse } from 'next/server';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { fetchAllLatestResults } from '@/lib/dune';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QUERY_ID = 6214515;
const COLUMNS = ['sender','lockTime','lockUpId','title','amount','receiver','unlockTime','unlocked'];

function normalizeAddr(a: string | null | undefined): string | null {
  if (!a) return null;
  return String(a).toLowerCase();
}

function buildInFilter(addresses: string[]): string {
  // (unlocked = false) AND (receiver IN ('0x..','0x..'))
  const quoted = addresses.map(a => `'${a}'`).join(',');
  return `(unlocked = false) AND (receiver IN (${quoted}))`;
}

function serverSort(lockups: any[], connectedAddress?: string | null): any[] {
  const now = Math.floor(Date.now() / 1000);
  const conn = normalizeAddr(connectedAddress || '');
  // 1) receiver === connected first
  // 2) unlockTime > now asc
  // 3) unlockTime <= now desc amount
  return [...lockups].sort((a, b) => {
    const aConn = normalizeAddr(a.receiver) === conn ? 0 : 1;
    const bConn = normalizeAddr(b.receiver) === conn ? 0 : 1;
    if (aConn !== bConn) return aConn - bConn;
    const aActive = Number(a.unlockTime) > now;
    const bActive = Number(b.unlockTime) > now;
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    if (aActive && bActive) {
      return Number(a.unlockTime) - Number(b.unlockTime);
    }
    // both expired/unstakeable -> sort by amount desc
    const aAmt = Number(a.amount ?? '0');
    const bAmt = Number(b.amount ?? '0');
    if (aAmt !== bAmt) return bAmt - aAmt;
    return 0;
  });
}

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
      limit: 100, // fetch a window; server-side sort then page
      filters,
    });

    const normalized = rows.map((r: any) => ({
      lockUpId: Number(r.lockUpId),
      sender: String(r.sender || '').toLowerCase(),
      receiver: String(r.receiver || '').toLowerCase(),
      amount: r.amount, // keep as string
      unlockTime: Number(r.unlockTime || 0),
      lockTime: Number(r.lockTime || 0),
      unlocked: Boolean(r.unlocked),
      title: String(r.title || ''),
    }));

    const sorted = serverSort(normalized, connectedAddress);
    const paged = sorted.slice(offset, offset + pageSize);
    const nextOffset = offset + pageSize < sorted.length ? offset + pageSize : null;

    return NextResponse.json({
      items: paged,
      nextOffset,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}



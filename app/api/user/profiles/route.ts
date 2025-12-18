import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseFidsParam(raw: string | null): number[] {
  if (!raw) return [];
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  const fids = parts
    .map(p => parseInt(p, 10))
    .filter(n => Number.isFinite(n) && n > 0);
  // de-dupe preserving order
  const seen = new Set<number>();
  const out: number[] = [];
  for (const fid of fids) {
    if (!seen.has(fid)) {
      seen.add(fid);
      out.push(fid);
    }
  }
  return out;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const raw = searchParams.get('fids');
    const fids = parseFidsParam(raw);

    // Keep response shape stable for clients
    if (fids.length === 0) {
      return NextResponse.json({ users: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Safety cap (Neynar fetchBulkUsers supports up to 100)
    const capped = fids.slice(0, 100);

    const neynarApiKey = process.env.NEYNAR_API_KEY;
    if (!neynarApiKey || neynarApiKey === 'your_neynar_api_key_here') {
      return NextResponse.json(
        { users: capped.map(fid => ({ fid, pfpUrl: '' })) },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const { NeynarAPIClient } = await import('@neynar/nodejs-sdk');
    const neynarClient = new NeynarAPIClient({ apiKey: neynarApiKey });

    const res = await neynarClient.fetchBulkUsers({ fids: capped });
    const map = new Map<number, string>();
    for (const u of (res.users ?? [])) {
      map.set(u.fid, u.pfp_url || '');
    }

    return NextResponse.json(
      { users: capped.map(fid => ({ fid, pfpUrl: map.get(fid) || '' })) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    console.error('[profiles API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error?.message || String(error) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}



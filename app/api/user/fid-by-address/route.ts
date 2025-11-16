import { NextRequest, NextResponse } from 'next/server';
import { getFidsFromAddresses } from '@/lib/services/stake-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const address = req.nextUrl.searchParams.get('address');
    if (!address) {
      return NextResponse.json({ error: 'address required' }, { status: 400 });
    }
    const map = await getFidsFromAddresses([address.toLowerCase()]);
    const fid = map.get(address.toLowerCase()) ?? null;
    return NextResponse.json({ fid }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}



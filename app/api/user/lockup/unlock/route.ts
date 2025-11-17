import { NextRequest, NextResponse } from 'next/server';
import { updateLockupUnlockedState } from '@/lib/services/db-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  let h = String(hash).trim().toLowerCase();
  if (!h) return null;
  if (!h.startsWith('0x')) {
    if (/^[0-9a-f]+$/i.test(h)) {
      h = `0x${h}`;
    } else {
      return null;
    }
  }
  return h;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const castHash = normalizeHash(body.castHash);
    const lockUpId = Number(body.lockUpId);
    const stakeType = body.stakeType === 'caster' || body.stakeType === 'supporter' ? body.stakeType : null;

    if (!castHash || !Number.isFinite(lockUpId) || !stakeType) {
      return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
    }

    const updated = await updateLockupUnlockedState(castHash, {
      type: stakeType,
      lockupId: lockUpId,
      unlocked: true,
    });

    if (!updated) {
      return NextResponse.json({ error: 'lockup not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}



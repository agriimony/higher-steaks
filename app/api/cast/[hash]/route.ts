import { NextRequest, NextResponse } from 'next/server';
import { getCastByHash } from '@/lib/services/cast-service';
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

    // Get cast - checks database first, falls back to Neynar
    const castData = await getCastByHash(castHash);

    if (!castData) {
      return NextResponse.json(
        { error: 'Higher cast not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      hash: castData.hash,
      fid: castData.fid,
      username: castData.username,
      displayName: castData.displayName,
      pfpUrl: castData.pfpUrl,
      castText: castData.castText,
      description: castData.description,
      timestamp: castData.timestamp,
      valid: castData.valid,
      state: castData.state,
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


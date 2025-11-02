import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Keyphrase to filter casts
const KEYPHRASE_REGEX = /started\s+aiming\s+higher\s+and\s+it\s+worked\s+out!\s*(.+)/i;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const hashParam = searchParams.get('hash');

    if (!hashParam) {
      return NextResponse.json(
        { error: 'Cast hash is required' },
        { status: 400 }
      );
    }

    const neynarApiKey = process.env.NEYNAR_API_KEY;

    if (!neynarApiKey || neynarApiKey === 'your_neynar_api_key_here') {
      return NextResponse.json(
        { error: 'Neynar API key not configured' },
        { status: 500 }
      );
    }

    // Lazy import Neynar SDK
    const { NeynarAPIClient } = await import('@neynar/nodejs-sdk');
    const neynarClient = new NeynarAPIClient({ apiKey: neynarApiKey });

    // Fetch cast by hash
    const castResponse = await neynarClient.lookupCastByHashOrUrl({ 
      identifier: hashParam,
      type: 'hash'
    });
    const cast = castResponse.cast;

    if (!cast) {
      return NextResponse.json({
        valid: false,
        reason: 'Cast not found'
      });
    }

    // Validate keyphrase
    const hasKeyphrase = KEYPHRASE_REGEX.test(cast.text);
    if (!hasKeyphrase) {
      return NextResponse.json({
        valid: false,
        reason: 'Cast missing required keyphrase'
      });
    }

    // Validate /higher channel
    const isHigherChannel = cast.channel?.id === 'higher' || cast.parent_url?.includes('/higher');
    if (!isHigherChannel) {
      return NextResponse.json({
        valid: false,
        reason: 'Cast not in /higher channel'
      });
    }

    return NextResponse.json({
      valid: true,
      hash: cast.hash,
      fid: cast.author.fid,
      text: cast.text,
      timestamp: cast.timestamp
    });

  } catch (error: any) {
    console.error('[Validate Cast API] Error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        message: error.message || String(error),
        valid: false
      },
      { status: 500 }
    );
  }
}


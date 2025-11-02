import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Keyphrase to filter casts
const KEYPHRASE_REGEX = /started\s+aiming\s+higher\s+and\s+it\s+worked\s+out!\s*(.+)/i;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const hashParam = searchParams.get('hash');

    console.log('[Validate Cast] Request received:', { hashParam });

    if (!hashParam) {
      console.log('[Validate Cast] Missing hash parameter');
      return NextResponse.json(
        { error: 'Cast hash is required' },
        { status: 400 }
      );
    }

    const neynarApiKey = process.env.NEYNAR_API_KEY;

    if (!neynarApiKey || neynarApiKey === 'your_neynar_api_key_here') {
      console.log('[Validate Cast] Neynar API key not configured');
      return NextResponse.json(
        { error: 'Neynar API key not configured' },
        { status: 500 }
      );
    }

    // Lazy import Neynar SDK
    const { NeynarAPIClient } = await import('@neynar/nodejs-sdk');
    const neynarClient = new NeynarAPIClient({ apiKey: neynarApiKey });

    console.log('[Validate Cast] Calling Neynar lookupCastByHashOrUrl with:', {
      identifier: hashParam,
      type: 'hash'
    });

    // Fetch cast by hash
    const castResponse = await neynarClient.lookupCastByHashOrUrl({ 
      identifier: hashParam,
      type: 'hash'
    });

    console.log('[Validate Cast] Neynar response:', {
      hasCast: !!castResponse.cast,
      castHash: castResponse.cast?.hash,
      castAuthorFid: castResponse.cast?.author?.fid,
      castText: castResponse.cast?.text?.substring(0, 100),
      channelId: castResponse.cast?.channel?.id,
      parentUrl: castResponse.cast?.parent_url
    });

    const cast = castResponse.cast;

    if (!cast) {
      console.log('[Validate Cast] Cast not found in response');
      return NextResponse.json({
        valid: false,
        reason: 'Cast not found'
      });
    }

    // Validate keyphrase
    const hasKeyphrase = KEYPHRASE_REGEX.test(cast.text);
    console.log('[Validate Cast] Keyphrase validation:', {
      hasKeyphrase,
      textPreview: cast.text.substring(0, 100)
    });
    
    if (!hasKeyphrase) {
      return NextResponse.json({
        valid: false,
        reason: 'Cast missing required keyphrase'
      });
    }

    // Validate /higher channel
    const isHigherChannel = cast.channel?.id === 'higher' || cast.parent_url?.includes('/higher');
    console.log('[Validate Cast] Channel validation:', {
      isHigherChannel,
      channelId: cast.channel?.id,
      parentUrl: cast.parent_url
    });
    
    if (!isHigherChannel) {
      return NextResponse.json({
        valid: false,
        reason: 'Cast not in /higher channel'
      });
    }

    console.log('[Validate Cast] Validation successful:', {
      hash: cast.hash,
      fid: cast.author.fid
    });

    return NextResponse.json({
      valid: true,
      hash: cast.hash,
      fid: cast.author.fid,
      text: cast.text,
      timestamp: cast.timestamp
    });

  } catch (error: any) {
    console.error('[Validate Cast] Error:', error);
    console.error('[Validate Cast] Error message:', error.message);
    console.error('[Validate Cast] Error stack:', error.stack);
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


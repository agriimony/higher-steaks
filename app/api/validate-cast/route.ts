import { NextRequest, NextResponse } from 'next/server';
import { KEYPHRASE_REGEX, containsKeyphrase, extractDescription } from '@/lib/cast-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const hashParam = searchParams.get('hash');
    const isUrlParam = searchParams.get('isUrl');

    console.log('[Validate Cast] Request received:', { hashParam, isUrlParam });

    if (!hashParam) {
      console.log('[Validate Cast] Missing hash parameter');
      return NextResponse.json(
        { error: 'Cast hash or URL is required' },
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

    // Determine the type based on whether it's a URL
    // Try 'url' type for full URLs, otherwise try 'hash'
    let lookupType: 'hash' | 'url' = isUrlParam === 'true' ? 'url' : 'hash';
    
    console.log('[Validate Cast] Calling Neynar lookupCastByHashOrUrl with:', {
      identifier: hashParam,
      type: lookupType
    });

    // Fetch cast by hash or URL - try both if first attempt fails
    let castResponse;
    try {
      castResponse = await neynarClient.lookupCastByHashOrUrl({ 
        identifier: hashParam,
        type: lookupType
      });
    } catch (firstError: any) {
      // If URL type failed, try hash type as fallback
      if (lookupType === 'url' && firstError.message?.includes('400')) {
        console.log('[Validate Cast] URL type failed, trying hash type instead');
        lookupType = 'hash';
        castResponse = await neynarClient.lookupCastByHashOrUrl({ 
          identifier: hashParam,
          type: lookupType
        });
      } else {
        throw firstError;
      }
    }

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
    const hasKeyphrase = containsKeyphrase(cast.text);
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

    // Extract description from cast text
    const description = extractDescription(cast.text);

    console.log('[Validate Cast] Validation successful:', {
      hash: cast.hash,
      fid: cast.author.fid
    });

    return NextResponse.json({
      valid: true,
      hash: cast.hash,
      fid: cast.author.fid,
      castText: cast.text,
      description: description,
      timestamp: cast.timestamp,
      author: cast.author
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


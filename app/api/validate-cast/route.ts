import { NextRequest, NextResponse } from 'next/server';
import { validateCast } from '@/lib/services/cast-service';

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

    // Handle URL format - extract hash if needed
    let castHash = hashParam;
    
    if (isUrlParam === 'true' || hashParam.includes('farcaster.xyz') || hashParam.includes('warpcast.com')) {
      // Extract hash from URL if needed
      if (hashParam.includes('warpcast.com')) {
        const match = hashParam.match(/warpcast\.com\/[^/]+\/([a-zA-Z0-9]+)$/);
        if (match && match[1]) {
          castHash = match[1].startsWith('0x') ? match[1] : '0x' + match[1];
        } else {
          // Keep as URL if extraction fails
          castHash = hashParam;
        }
      } else if (hashParam.includes('farcaster.xyz')) {
        // For farcaster.xyz URLs, use as-is (will be handled by Neynar)
        castHash = hashParam;
      }
    } else {
      // Assume it's a hash - add 0x prefix if missing
      if (!castHash.startsWith('0x') && /^[a-fA-F0-9]+$/.test(castHash)) {
        castHash = '0x' + castHash;
      }
    }

    // Use cast service - validateCast now handles URLs properly
    const result = await validateCast(castHash);

    if (!result.valid) {
      return NextResponse.json({
        valid: false,
        reason: result.reason || 'Cast not found or invalid'
      });
    }

    if (!result.castData) {
      return NextResponse.json({
        valid: false,
        reason: 'Cast data not available'
      });
    }

    console.log('[Validate Cast] Validation successful:', {
      hash: result.castData.hash,
      fid: result.castData.fid,
      state: result.castData.state
    });

    return NextResponse.json({
      valid: true,
      hash: result.castData.hash,
      fid: result.castData.fid,
      castText: result.castData.castText,
      description: result.castData.description,
      timestamp: result.castData.timestamp,
      author: {
        fid: result.castData.fid,
        username: result.castData.username,
        display_name: result.castData.displayName,
        pfp_url: result.castData.pfpUrl,
      },
      state: result.castData.state
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


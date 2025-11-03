import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { extractDescription } from '@/lib/cast-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const fidParam = searchParams.get('fid');

    if (!fidParam) {
      return NextResponse.json(
        { error: 'FID is required' },
        { status: 400 }
      );
    }

    const fid = parseInt(fidParam, 10);

    if (isNaN(fid)) {
      return NextResponse.json(
        { error: 'Invalid FID' },
        { status: 400 }
      );
    }

    console.log(`[User Casts API] Fetching casts for FID ${fid}`);

    // Step 1: Query database for cast by creator FID (with error handling for schema issues)
    try {
      const dbResult = await sql`
        SELECT * FROM leaderboard_entries 
        WHERE creator_fid = ${fid} 
        ORDER BY total_higher_staked DESC 
        LIMIT 1
      `;

      if (dbResult.rows && dbResult.rows.length > 0) {
        const castData = dbResult.rows[0];
        console.log(`[User Casts API] Found cast in database: ${castData.cast_hash}`);
        
        return NextResponse.json({
          hasCast: true,
          hash: castData.cast_hash,
          text: castData.cast_text,
          description: castData.description,
          timestamp: castData.cast_timestamp,
          totalStaked: parseFloat(castData.total_higher_staked),
          rank: castData.rank,
        });
      }
    } catch (dbError: any) {
      console.log(`[User Casts API] Database query failed (likely schema issue):`, dbError.message);
      // Continue to Neynar fallback
    }

    // Step 2: Fallback to Neynar if not found in database
    console.log(`[User Casts API] No cast found in database, checking Neynar...`);
    
    const neynarApiKey = process.env.NEYNAR_API_KEY;

    if (!neynarApiKey || neynarApiKey === 'your_neynar_api_key_here') {
      return NextResponse.json({
        hasCast: false,
        totalStaked: 0,
        rank: null,
      });
    }

    // Lazy import Neynar SDK
    const { NeynarAPIClient } = await import('@neynar/nodejs-sdk');
    const neynarClient = new NeynarAPIClient({ apiKey: neynarApiKey });

    // Fetch user's casts
    const userCasts = await neynarClient.fetchCastsForUser({
      fid: fid,
      limit: 25,
    });

    // Filter for /higher channel casts with keyphrase
    const higherCasts = (userCasts.casts || []).filter((cast: any) => {
      const isHigherChannel = cast.channel?.id === 'higher' || cast.parent_url?.includes('/higher');
      const hasKeyphrase = extractDescription(cast.text);
      return isHigherChannel && hasKeyphrase;
    });

    if (higherCasts.length > 0) {
      // Take most recent matching cast
      const latestCast = higherCasts[0];
      const description = extractDescription(latestCast.text);
      
      if (description) {
        console.log(`[User Casts API] Found cast via Neynar: ${latestCast.hash}`);
        
        return NextResponse.json({
          hasCast: true,
          hash: latestCast.hash,
          text: latestCast.text,
          description: description,
          timestamp: latestCast.timestamp,
          totalStaked: 0,
          rank: null,
        });
      }
    }

    console.log(`[User Casts API] No matching cast found`);
    return NextResponse.json({
      hasCast: false,
      totalStaked: 0,
      rank: null,
    });

  } catch (error: any) {
    console.error('[User Casts API] Error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        message: error.message || String(error),
      },
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noCacheHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const fidParam = searchParams.get('fid');

    if (!fidParam) {
      return NextResponse.json(
        { error: 'FID is required' },
        {
          status: 400,
          headers: noCacheHeaders,
        }
      );
    }

    const fid = parseInt(fidParam, 10);

    if (isNaN(fid)) {
      return NextResponse.json(
        { error: 'Invalid FID' },
        {
          status: 400,
          headers: noCacheHeaders,
        }
      );
    }

    console.log(`[User Casts All API] Fetching all casts for FID ${fid}`);

    try {
      // Query all casts (higher and expired) for this user
      // Sort: higher casts first (by total_higher_staked DESC), then expired casts (by cast_timestamp DESC)
      const timestamp = Date.now();
      const dbResult = await sql`
        SELECT * FROM leaderboard_entries 
        WHERE creator_fid = ${fid} 
        AND cast_state IN ('higher', 'expired')
        AND ${timestamp} = ${timestamp} 
        ORDER BY 
          CASE WHEN cast_state = 'higher' THEN 0 ELSE 1 END,
          CASE WHEN cast_state = 'higher' THEN total_higher_staked ELSE 0 END DESC,
          CASE WHEN cast_state = 'expired' THEN cast_timestamp END DESC
      `;

      if (dbResult.rows && dbResult.rows.length > 0) {
        const casts = dbResult.rows.map((row) => ({
          hash: row.cast_hash,
          text: row.cast_text,
          description: row.description,
          timestamp: row.cast_timestamp,
          castState: row.cast_state || 'higher',
          rank: row.rank,
          totalHigherStaked: parseFloat(row.total_higher_staked || '0'),
          casterStakeLockupIds: row.caster_stake_lockup_ids || [],
          casterStakeAmounts: row.caster_stake_amounts?.map((a: any) => a.toString()) || [],
          casterStakeUnlockTimes: row.caster_stake_unlock_times || [],
          supporterStakeLockupIds: row.supporter_stake_lockup_ids || [],
          supporterStakeAmounts: row.supporter_stake_amounts?.map((a: any) => a.toString()) || [],
          supporterStakeFids: row.supporter_stake_fids || [],
        }));

        console.log(`[User Casts All API] Found ${casts.length} casts in database`);
        
        return NextResponse.json(
          { casts },
          { headers: noCacheHeaders }
        );
      }

      console.log(`[User Casts All API] No casts found in database`);
      return NextResponse.json(
        { casts: [] },
        { headers: noCacheHeaders }
      );
    } catch (dbError: any) {
      console.error(`[User Casts All API] Database query failed:`, dbError.message);
      return NextResponse.json(
        {
          error: 'Database query failed',
          message: dbError.message,
        },
        {
          status: 500,
          headers: noCacheHeaders,
        }
      );
    }
  } catch (error: any) {
    console.error('[User Casts All API] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || String(error),
      },
      {
        status: 500,
        headers: noCacheHeaders,
      }
    );
  }
}


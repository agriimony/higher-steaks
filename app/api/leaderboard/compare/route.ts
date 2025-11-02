import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Run the exact same queries as both endpoints
    const countQuery = await sql`SELECT COUNT(*) as count FROM leaderboard_entries`;
    const topQuery = await sql`
      SELECT 
        creator_fid,
        creator_username,
        creator_display_name,
        creator_pfp_url,
        cast_hash,
        cast_text,
        description,
        cast_timestamp,
        total_higher_staked,
        usd_value,
        rank
      FROM leaderboard_entries
      ORDER BY total_higher_staked DESC
      LIMIT 10
    `;
    const allQuery = await sql`
      SELECT creator_fid, creator_username, description, total_higher_staked 
      FROM leaderboard_entries 
      ORDER BY total_higher_staked DESC
    `;
    
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      envVars: {
        POSTGRES_URL: !!process.env.POSTGRES_URL,
        POSTGRES_PRISMA_URL: !!process.env.POSTGRES_PRISMA_URL,
        POSTGRES_URL_NON_POOLING: !!process.env.POSTGRES_URL_NON_POOLING,
      },
      countQuery: {
        count: countQuery.rows[0]?.count,
      },
      topQuery: {
        rowCount: topQuery.rows.length,
        rows: topQuery.rows,
      },
      allQuery: {
        rowCount: allQuery.rows.length,
        rows: allQuery.rows,
      },
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack,
    }, { status: 500 });
  }
}


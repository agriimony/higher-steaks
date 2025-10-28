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
        fid,
        username,
        display_name,
        pfp_url,
        cast_hash,
        cast_text,
        description,
        cast_timestamp,
        higher_balance,
        usd_value,
        rank
      FROM leaderboard_entries
      ORDER BY higher_balance DESC
      LIMIT 10
    `;
    const allQuery = await sql`
      SELECT fid, username, description, higher_balance 
      FROM leaderboard_entries 
      ORDER BY higher_balance DESC
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


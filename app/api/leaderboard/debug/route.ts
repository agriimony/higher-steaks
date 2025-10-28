import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Check if table exists
    const tableCheck = await sql`
      SELECT COUNT(*) as count 
      FROM leaderboard_entries
    `;
    
    const count = parseInt(tableCheck.rows[0]?.count || '0');
    
    // Test the EXACT same query as /api/leaderboard/top
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
    
    // Get all entries
    const allEntries = await sql`
      SELECT 
        fid,
        username,
        display_name,
        cast_hash,
        description,
        higher_balance,
        usd_value,
        rank,
        cast_timestamp
      FROM leaderboard_entries
      ORDER BY higher_balance DESC
    `;
    
    return NextResponse.json({
      tableExists: true,
      totalEntries: count,
      topQueryResults: topQuery.rows.length,
      topQueryData: topQuery.rows,
      allEntries: allEntries.rows,
      rawData: allEntries.rows.map(row => ({
        ...row,
        higher_balance: row.higher_balance?.toString(),
        usd_value: row.usd_value?.toString(),
      })),
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack,
      tableExists: false,
    }, { status: 500 });
  }
}


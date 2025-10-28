import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // Disable caching for fresh data

export async function GET() {
  try {
    // Query top 10 users by HIGHER balance
    const result = await sql`
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

    // Format data for frontend
    const entries = result.rows.map((row) => ({
      fid: row.fid,
      username: row.username,
      displayName: row.display_name,
      pfpUrl: row.pfp_url,
      castHash: row.cast_hash,
      castText: row.cast_text,
      description: row.description,
      castTimestamp: row.cast_timestamp,
      higherBalance: parseFloat(row.higher_balance).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      usdValue: row.usd_value
        ? `$${parseFloat(row.usd_value).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`
        : '$0.00',
      rank: row.rank,
    }));

    return NextResponse.json({ entries });
  } catch (error) {
    console.error('Leaderboard API error:', error);
    
    // Return empty array if table doesn't exist yet
    return NextResponse.json({ 
      entries: [],
      error: 'Database not initialized or empty',
    });
  }
}


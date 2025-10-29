import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    console.log('=== Database Verification Endpoint ===');
    
    // Force a fresh connection by using the non-pooling URL
    const envCheck = {
      POSTGRES_URL: !!process.env.POSTGRES_URL,
      POSTGRES_PRISMA_URL: !!process.env.POSTGRES_PRISMA_URL,
      POSTGRES_URL_NON_POOLING: !!process.env.POSTGRES_URL_NON_POOLING,
    };
    
    console.log('Environment variables:', envCheck);
    
    // Get current timestamp
    const timestamp = new Date().toISOString();
    
    // Count entries
    const countResult = await sql`SELECT COUNT(*) as count FROM leaderboard_entries`;
    const count = parseInt(countResult.rows[0]?.count || '0');
    
    // Get all entries with full details
    const allEntries = await sql`
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
        rank,
        updated_at
      FROM leaderboard_entries
      ORDER BY higher_balance DESC
    `;
    
    return NextResponse.json({
      timestamp,
      envCheck,
      totalEntries: count,
      entries: allEntries.rows.map(row => ({
        fid: row.fid,
        username: row.username,
        displayName: row.display_name,
        castHash: row.cast_hash,
        description: row.description,
        higherBalance: row.higher_balance?.toString(),
        usdValue: row.usd_value?.toString(),
        rank: row.rank,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error: any) {
    console.error('Verification error:', error);
    return NextResponse.json({
      error: error.message,
      stack: error.stack,
    }, { status: 500 });
  }
}


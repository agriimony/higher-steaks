import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // Disable caching for fresh data
export const revalidate = 0; // Never cache

export async function GET() {
  try {
    console.log('=== Fetching leaderboard entries ===');
    console.log('POSTGRES_URL exists:', !!process.env.POSTGRES_URL);
    console.log('POSTGRES_PRISMA_URL exists:', !!process.env.POSTGRES_PRISMA_URL);
    console.log('POSTGRES_URL_NON_POOLING exists:', !!process.env.POSTGRES_URL_NON_POOLING);
    
    // First, let's verify the connection works
    const testQuery = await sql`SELECT 1 as test`;
    console.log('Database connection test:', testQuery.rows[0]);
    
    // Query top 10 users by HIGHER balance
    // Using the same query structure that works in /compare
    const result = await sql`
      SELECT * FROM leaderboard_entries 
      ORDER BY higher_balance DESC
      LIMIT 10
    `;

    console.log(`Query returned ${result.rows.length} rows`);
    
    if (result.rows.length === 0) {
      console.log('No entries found in database');
      return NextResponse.json({ entries: [] });
    }

    // Format data for frontend - with error handling per row
    const entries = [];
    
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      try {
        console.log(`Processing row ${i + 1}:`, {
          fid: row.fid,
          username: row.username,
          has_description: !!row.description,
          higher_balance: row.higher_balance?.toString(),
          usd_value: row.usd_value?.toString(),
        });
        
        const entry = {
          fid: row.fid,
          username: row.username,
          displayName: row.display_name || row.username,
          pfpUrl: row.pfp_url || '',
          castHash: row.cast_hash,
          castText: row.cast_text,
          description: row.description,
          castTimestamp: row.cast_timestamp,
          higherBalance: row.higher_balance 
            ? parseFloat(row.higher_balance).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : '0.00',
          usdValue: row.usd_value
            ? `$${parseFloat(row.usd_value).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`
            : '$0.00',
          rank: row.rank || i + 1,
        };
        
        entries.push(entry);
        console.log(`Row ${i + 1} formatted successfully`);
      } catch (rowError: any) {
        console.error(`Error processing row ${i + 1}:`, rowError.message);
        console.error('Row data:', row);
        // Continue to next row
      }
    }

    console.log(`=== Returning ${entries.length} entries ===`);
    return NextResponse.json({ entries });
  } catch (error: any) {
    console.error('=== LEADERBOARD API ERROR ===');
    console.error('Error:', error);
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    
    // Return detailed error for debugging
    return NextResponse.json({ 
      entries: [],
      error: error.message || 'Database error',
      details: error.stack,
    }, { status: 500 });
  }
}


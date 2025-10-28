import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const logs: string[] = [];
  
  try {
    logs.push('Step 1: Checking environment variables...');
    const neynarApiKey = process.env.NEYNAR_API_KEY;
    const postgresUrl = process.env.POSTGRES_URL;
    
    logs.push(`- Neynar API Key: ${neynarApiKey ? 'SET (length: ' + neynarApiKey.length + ')' : 'MISSING'}`);
    logs.push(`- Postgres URL: ${postgresUrl ? 'SET' : 'MISSING'}`);
    
    if (!neynarApiKey) {
      return NextResponse.json({
        error: 'Neynar API key not configured',
        logs,
      }, { status: 500 });
    }
    
    if (!postgresUrl) {
      return NextResponse.json({
        error: 'Postgres not configured',
        logs,
      }, { status: 500 });
    }
    
    logs.push('Step 2: Importing Neynar SDK...');
    const { NeynarAPIClient } = await import('@neynar/nodejs-sdk');
    logs.push('- Neynar SDK imported successfully');
    
    logs.push('Step 3: Creating Neynar client...');
    const neynarClient = new NeynarAPIClient({ apiKey: neynarApiKey });
    logs.push('- Neynar client created');
    
    logs.push('Step 4: Testing Neynar API call (fetchFeedByChannelIds - FREE TIER)...');
    try {
      const castsResponse = await neynarClient.fetchFeedByChannelIds({
        channelIds: ['higher'],
        limit: 5, // Just 5 for testing
        withRecasts: false,
      });
      
      const casts = castsResponse.casts || [];
      logs.push(`- Found ${casts.length} casts from /higher channel`);
      
      if (casts.length > 0) {
        logs.push(`- First cast author: @${casts[0].author.username}`);
        logs.push(`- First cast FID: ${casts[0].author.fid}`);
        logs.push(`- First cast text: ${casts[0].text.substring(0, 100)}...`);
      }
    } catch (neynarError: any) {
      logs.push(`- Neynar API error: ${neynarError.message || String(neynarError)}`);
      if (neynarError.response) {
        logs.push(`- Response status: ${neynarError.response.status}`);
        logs.push(`- Response data: ${JSON.stringify(neynarError.response.data)}`);
      }
      throw neynarError;
    }
    
    logs.push('Step 5: Testing database connection...');
    const { sql } = await import('@vercel/postgres');
    const dbTest = await sql`SELECT NOW() as time`;
    logs.push(`- Database connected: ${dbTest.rows[0].time}`);
    
    logs.push('Step 6: Checking leaderboard table...');
    const tableCheck = await sql`SELECT COUNT(*) as count FROM leaderboard_entries`;
    logs.push(`- Table exists with ${tableCheck.rows[0].count} entries`);
    
    logs.push('✅ All checks passed!');
    
    return NextResponse.json({
      success: true,
      logs,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error: any) {
    logs.push(`❌ Error: ${error.message || String(error)}`);
    
    return NextResponse.json({
      error: 'Test failed',
      message: error.message || String(error),
      logs,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}


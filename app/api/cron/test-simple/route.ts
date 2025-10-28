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
    
    logs.push('Step 4: Testing Neynar API endpoints...');
    
    // Test which endpoints work on free tier
    let apiTestResults: any = {};
    
    // Test 1: fetchBulkUsers (should work - basic endpoint)
    try {
      logs.push('- Testing fetchBulkUsers (basic endpoint)...');
      const userTest = await neynarClient.fetchBulkUsers({ fids: [3] }); // Test with dwr
      apiTestResults.fetchBulkUsers = '✅ Works';
      logs.push(`  ✅ fetchBulkUsers works: @${userTest.users[0].username}`);
    } catch (e: any) {
      apiTestResults.fetchBulkUsers = '❌ ' + e.message;
      logs.push(`  ❌ fetchBulkUsers failed: ${e.message}`);
    }
    
    // Test 2: searchCasts with channel_id (RECOMMENDED FOR FREE TIER)
    try {
      logs.push('- Testing searchCasts with channel_id and keyphrase...');
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const afterDate = yesterday.toISOString().split('T')[0];
      
      const searchTest = await neynarClient.searchCasts({
        q: `started aiming higher and it worked out after:${afterDate}`,
        channelId: 'higher',
        limit: 5,
      });
      const casts = searchTest.result?.casts || [];
      apiTestResults.searchCasts = '✅ Works';
      logs.push(`  ✅ searchCasts works: ${casts.length} casts with keyphrase`);
      
      if (casts.length > 0) {
        logs.push(`  First match: @${casts[0].author.username} - ${casts[0].text.substring(0, 80)}...`);
      }
    } catch (e: any) {
      apiTestResults.searchCasts = '❌ ' + e.message;
      logs.push(`  ❌ searchCasts failed: ${e.message}`);
    }
    
    logs.push('');
    logs.push('API Test Summary:');
    Object.entries(apiTestResults).forEach(([endpoint, result]) => {
      logs.push(`  ${endpoint}: ${result}`);
    });
    
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


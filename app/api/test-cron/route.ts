import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST() {
  try {
    const cronSecret = process.env.CRON_SECRET;
    
    if (!cronSecret) {
      return NextResponse.json({
        error: 'CRON_SECRET not configured in environment variables',
      }, { status: 500 });
    }

    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';

    console.log('=== Running Cron Test ===');
    console.log('Base URL:', baseUrl);

    // Step 1: Run the cron job
    console.log('Step 1: Triggering cron job...');
    const cronResponse = await fetch(`${baseUrl}/api/cron/update-staking-leaderboard?secret=${cronSecret}`);
    const cronData = await cronResponse.json();
    console.log('Cron response:', cronData);

    // Wait 2 seconds for database to settle
    console.log('Waiting 2 seconds for database to settle...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Check verify endpoint
    console.log('Step 2: Checking verify endpoint...');
    const verifyResponse = await fetch(`${baseUrl}/api/leaderboard/verify`);
    const verifyData = await verifyResponse.json();
    console.log('Verify response:', verifyData);

    // Step 3: Check debug endpoint
    console.log('Step 3: Checking debug endpoint...');
    const debugResponse = await fetch(`${baseUrl}/api/leaderboard/debug`);
    const debugData = await debugResponse.json();
    console.log('Debug response:', debugData);

    // Step 4: Check top endpoint
    console.log('Step 4: Checking top endpoint...');
    const topResponse = await fetch(`${baseUrl}/api/leaderboard/top`);
    const topData = await topResponse.json();
    console.log('Top response:', topData);

    console.log('=== Test Complete ===');

    return NextResponse.json({
      success: true,
      results: {
        cron: cronData,
        verify: verifyData,
        debug: debugData,
        top: topData,
      },
      summary: {
        cronStored: cronData.stored || 0,
        verifyCount: verifyData.totalEntries || 0,
        debugCount: debugData.totalEntries || 0,
        topReturned: topData.entries?.length || 0,
        allSynced: (
          cronData.stored === verifyData.totalEntries &&
          verifyData.totalEntries === debugData.totalEntries &&
          topData.entries?.length > 0
        ),
      },
    });

  } catch (error: any) {
    console.error('Test error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack,
    }, { status: 500 });
  }
}


import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const cronSecret = body.secret;
    
    if (!cronSecret) {
      return NextResponse.json({
        error: 'CRON_SECRET not provided in request',
      }, { status: 400 });
    }

    // Get the base URL from the request headers
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const host = request.headers.get('host') || 'localhost:3000';
    const baseUrl = `${protocol}://${host}`;

    console.log('=== Running Cron Test ===');
    console.log('Base URL:', baseUrl);

    // Step 1: Run the cron job
    console.log('Step 1: Triggering cron job...');
    const cronUrl = `${baseUrl}/api/cron/update-staking-leaderboard?secret=${cronSecret}`;
    console.log('Cron URL:', cronUrl);
    
    const cronResponse = await fetch(cronUrl);
    console.log('Cron response status:', cronResponse.status);
    console.log('Cron response headers:', Object.fromEntries(cronResponse.headers.entries()));
    
    const cronText = await cronResponse.text();
    console.log('Cron response text (first 500 chars):', cronText.substring(0, 500));
    
    let cronData;
    try {
      cronData = JSON.parse(cronText);
    } catch (parseError) {
      console.error('Failed to parse cron response as JSON:', parseError);
      cronData = { 
        error: 'Invalid JSON response', 
        statusCode: cronResponse.status,
        responsePreview: cronText.substring(0, 200),
      };
    }
    console.log('Cron response:', cronData);

    // Wait 2 seconds for database to settle
    console.log('Waiting 2 seconds for database to settle...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Check verify endpoint
    console.log('Step 2: Checking verify endpoint...');
    const verifyResponse = await fetch(`${baseUrl}/api/leaderboard/verify`, {
      headers: { 'Accept': 'application/json' },
    });
    const verifyData = await verifyResponse.json();
    console.log('Verify response:', verifyData);

    // Step 3: Check debug endpoint
    console.log('Step 3: Checking debug endpoint...');
    const debugResponse = await fetch(`${baseUrl}/api/leaderboard/debug`, {
      headers: { 'Accept': 'application/json' },
    });
    const debugData = await debugResponse.json();
    console.log('Debug response:', debugData);

    // Step 4: Check top endpoint
    console.log('Step 4: Checking top endpoint...');
    const topResponse = await fetch(`${baseUrl}/api/leaderboard/top`, {
      headers: { 'Accept': 'application/json' },
    });
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


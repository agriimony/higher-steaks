import { NextRequest, NextResponse } from 'next/server';
import { getNeynarClient } from '@/lib/neynar';

/**
 * POST /api/ingest/higher
 * Ingests casts from the "higher" channel filtered by regex pattern
 */
export async function POST(request: NextRequest) {
  try {
    const client = getNeynarClient();
    const body = await request.json();
    
    // Default pattern: casts starting with "i want to aim higher"
    const pattern = body.pattern || /^i want to aim higher/i;
    
    console.log(`Fetching casts from /higher channel matching pattern: ${pattern}`);
    
    // Fetch casts from the /higher channel
    const response = await client.fetchCasts({
      parentChannel: 'higher',
      limit: 100, // Fetch more casts to account for filtering
    });
    
    // Filter casts that match the regex pattern
    const matchingCasts = response.result.casts.filter((cast: any) => {
      const text = cast.text?.toLowerCase() || '';
      const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
      return regex.test(text);
    });
    
    // Return filtered results
    return NextResponse.json({
      success: true,
      total: response.result.casts.length,
      matched: matchingCasts.length,
      casts: matchingCasts,
      pattern: pattern.toString(),
    });
    
  } catch (error: any) {
    console.error('Higher channel ingestion error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to ingest data from /higher channel' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/ingest/higher
 * Gets recent matching casts (last fetched)
 */
export async function GET(request: NextRequest) {
  try {
    const client = getNeynarClient();
    const { searchParams } = new URL(request.url);
    const pattern = searchParams.get('pattern') || '^i want to aim higher';
    const limit = parseInt(searchParams.get('limit') || '100');
    
    console.log(`Fetching casts with pattern: ${pattern}`);
    
    const response = await client.fetchCasts({
      parentChannel: 'higher',
      limit,
    });
    
    // Filter casts that match the regex pattern
    const regex = new RegExp(pattern, 'i');
    const matchingCasts = response.result.casts.filter((cast: any) => {
      const text = cast.text?.toLowerCase() || '';
      return regex.test(text);
    });
    
    return NextResponse.json({
      success: true,
      total: response.result.casts.length,
      matched: matchingCasts.length,
      casts: matchingCasts,
      pattern: pattern,
    });
    
  } catch (error: any) {
    console.error('Error fetching /higher casts:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch data from /higher channel' },
      { status: 500 }
    );
  }
}


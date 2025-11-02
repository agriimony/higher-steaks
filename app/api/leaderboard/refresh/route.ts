import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Simple in-memory rate limiting (resets on serverless restart)
// Note: In production with multiple serverless instances, consider using Redis or similar
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  
  record.count++;
  return true;
}

export async function POST(request: NextRequest) {
  try {

    // Get client IP for rate limiting
    const ip = request.ip || 
               request.headers.get('x-forwarded-for') || 
               request.headers.get('x-real-ip') || 
               'unknown';
    
    console.log('[Leaderboard Refresh] Request from IP:', ip);
    
    // Check rate limit
    if (!checkRateLimit(ip)) {
      console.log('[Leaderboard Refresh] Rate limit exceeded for IP:', ip);
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      );
    }
    
    // Trigger the cron endpoint internally
    console.log('[Leaderboard Refresh] Triggering leaderboard update...');
    
    // Construct URL - handle both Vercel deployments and local dev
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${host}`;
    const cronUrl = `${baseUrl}/api/cron/update-staking-leaderboard`;
    
    // Forward the request to the cron endpoint (no auth required if CRON_SECRET not set)
    const cronResponse = await fetch(cronUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const cronData = await cronResponse.json();
    
    console.log('[Leaderboard Refresh] Cron response status:', cronResponse.status);
    
    if (!cronResponse.ok) {
      return NextResponse.json(
        { 
          error: 'Failed to refresh leaderboard',
          details: cronData
        },
        { status: cronResponse.status }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: 'Leaderboard refreshed successfully',
      data: cronData
    });
    
  } catch (error: any) {
    console.error('[Leaderboard Refresh] Error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error.message || String(error)
      },
      { status: 500 }
    );
  }
}


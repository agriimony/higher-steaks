import { NextRequest, NextResponse } from 'next/server';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const fidParam = searchParams.get('fid');
    
    if (!fidParam) {
      return NextResponse.json(
        { error: 'fid is required' },
        { status: 400 }
      );
    }

    const fid = parseInt(fidParam, 10);
    if (isNaN(fid)) {
      return NextResponse.json(
        { error: 'Invalid fid' },
        { status: 400 }
      );
    }

    const apiKey = process.env.NEYNAR_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'NEYNAR_API_KEY not configured' },
        { status: 500 }
      );
    }

    const neynar = new NeynarAPIClient({ apiKey });
    
    // Query Neynar API for notification token
    // Reference: https://docs.neynar.com/reference/fetch-notification-tokens
    const response = await neynar.fetchNotificationTokens({
      fids: [fid.toString()],
      limit: 1,
    });
    
    const tokenData = response.notification_tokens?.[0];
    const enabled = tokenData?.status === 'enabled';

    return NextResponse.json({ enabled });
  } catch (err: any) {
    console.error('[notifications/status] Error:', err);
    return NextResponse.json(
      { error: 'Failed to check notification status', message: err?.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fid, enabled } = body;
    
    if (!fid) {
      return NextResponse.json(
        { error: 'fid is required' },
        { status: 400 }
      );
    }

    // Note: Actual token storage/enabling is handled by Neynar via webhook events
    // This endpoint just returns success - the user must add the miniapp first
    // which will trigger the webhook event that stores the token in Neynar
    
    return NextResponse.json({ 
      success: true,
      message: 'Notification preference updated. Token management is handled by Neynar.',
    });
  } catch (err: any) {
    console.error('[notifications/status] Error:', err);
    return NextResponse.json(
      { error: 'Failed to update notification status', message: err?.message },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

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

    // Query database for enabled notification token
    const result = await sql`
      SELECT enabled FROM notification_tokens 
      WHERE fid = ${fid} AND enabled = true 
      LIMIT 1
    `;
    
    const enabled = result.rows.length > 0;

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

    // Note: Actual token storage/enabling is handled by webhook events
    // This endpoint just returns success - the user must add the miniapp first
    // which will trigger the webhook event that stores the token in our database
    
    return NextResponse.json({ 
      success: true,
      message: 'Notification preference updated. Token management is handled via webhook events.',
    });
  } catch (err: any) {
    console.error('[notifications/status] Error:', err);
    return NextResponse.json(
      { error: 'Failed to update notification status', message: err?.message },
      { status: 500 }
    );
  }
}

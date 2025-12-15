import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fid, threshold } = body;
    
    if (!fid) {
      return NextResponse.json(
        { error: 'fid is required' },
        { status: 400 }
      );
    }

    if (threshold === undefined || threshold === null) {
      return NextResponse.json(
        { error: 'threshold is required' },
        { status: 400 }
      );
    }

    const thresholdNum = parseFloat(threshold);
    if (isNaN(thresholdNum) || thresholdNum <= 0) {
      return NextResponse.json(
        { error: 'threshold must be a positive number' },
        { status: 400 }
      );
    }

    // Update threshold for user with enabled notifications
    const result = await sql`
      UPDATE notification_tokens
      SET threshold_usd = ${thresholdNum}, updated_at = NOW()
      WHERE fid = ${fid} AND enabled = true
      RETURNING id
    `;

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'User does not have enabled notifications' },
        { status: 404 }
      );
    }

    console.log('[notifications/threshold] Updated threshold for fid:', fid, 'to', thresholdNum);

    return NextResponse.json({ 
      success: true,
      threshold: thresholdNum,
      message: 'Threshold updated successfully',
    });
  } catch (err: any) {
    console.error('[notifications/threshold] Error:', err);
    return NextResponse.json(
      { error: 'Failed to update threshold', message: err?.message },
      { status: 500 }
    );
  }
}

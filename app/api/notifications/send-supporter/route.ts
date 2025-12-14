import { NextRequest, NextResponse } from 'next/server';
import { sendSupporterNotification } from '@/lib/services/notification-service';
import { getCastByHash } from '@/lib/services/cast-service';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { castHash, supporterFid, amount, txHash } = body;
    
    if (!castHash || !supporterFid || !amount) {
      return NextResponse.json(
        { error: 'castHash, supporterFid, and amount are required' },
        { status: 400 }
      );
    }

    // Get cast data to find owner FID and description
    const castData = await getCastByHash(castHash);
    if (!castData) {
      return NextResponse.json(
        { error: 'Cast not found' },
        { status: 404 }
      );
    }

    const castOwnerFid = castData.fid;
    
    // Don't send notification if staking on own cast
    if (castOwnerFid === supporterFid) {
      return NextResponse.json({
        success: false,
        message: 'Self-stakes do not trigger notifications',
      });
    }

    // Get supporter username from Neynar
    let supporterUsername = `user-${supporterFid}`;
    try {
      const apiKey = process.env.NEYNAR_API_KEY;
      if (apiKey) {
        const neynar = new NeynarAPIClient({ apiKey });
        const userResponse = await neynar.fetchBulkUsers({ fids: [supporterFid] });
        const user = userResponse.users?.[0];
        if (user?.username) {
          supporterUsername = user.username;
        }
      }
    } catch (err) {
      console.warn('[send-supporter] Failed to fetch supporter username:', err);
    }

    // Send notification
    const success = await sendSupporterNotification(
      castOwnerFid,
      supporterFid,
      amount,
      castHash,
      castData.description,
      supporterUsername
    );

    if (success) {
      return NextResponse.json({
        success: true,
        message: 'Supporter notification sent',
      });
    } else {
      return NextResponse.json({
        success: false,
        message: 'Notification not sent (may be below $10 minimum or already sent)',
      });
    }
  } catch (err: any) {
    console.error('[send-supporter] Error:', err);
    return NextResponse.json(
      { error: 'Failed to send supporter notification', message: err?.message },
      { status: 500 }
    );
  }
}

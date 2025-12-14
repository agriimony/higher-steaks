import { NextRequest, NextResponse } from 'next/server';
import { syncLockupsFromDune } from '@/lib/indexers/lockupsFromDune';
import { checkAndSendExpiredStakeNotifications } from '@/lib/services/notification-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max for cron job

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (Vercel automatically adds this header)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    // Only enforce auth if CRON_SECRET is set
    if (cronSecret && authHeader && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized - invalid secret' },
        { status: 401 }
      );
    }
    
    console.log('=== Starting staking leaderboard update (Dune-based) ===');

    const { castsUpserted } = await syncLockupsFromDune();

    console.log('=== Staking leaderboard updated successfully (Dune) ===', { castsUpserted });

    // Check for expired stakes and send notifications
    console.log('=== Checking for expired stakes and sending notifications ===');
    const notificationsSent = await checkAndSendExpiredStakeNotifications();
    console.log('=== Expired stake notifications sent ===', { notificationsSent });

    return NextResponse.json({
      success: true,
      castsUpserted,
      notificationsSent,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error: any) {
    console.error('=== STAKING LEADERBOARD UPDATE ERROR ===');
    console.error('Error:', error);
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        message: error.message || String(error),
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}


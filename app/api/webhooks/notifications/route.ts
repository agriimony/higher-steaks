import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface WebhookPayload {
  event: 'miniapp_added' | 'miniapp_removed' | 'notifications_enabled' | 'notifications_disabled';
  notificationDetails?: {
    url: string;
    token: string;
  };
  fid?: number;
  // FID might also be in the signature/headers - will need to extract if not in body
}

export async function POST(request: NextRequest) {
  try {
    const body: WebhookPayload = await request.json();
    const { event, notificationDetails, fid } = body;

    console.log('[webhooks/notifications] Received event:', event, { fid, hasNotificationDetails: !!notificationDetails });

    // Note: Webhook signature verification may be required per Farcaster spec
    // For now, we'll accept events. Add signature verification if needed.
    // Reference: https://miniapps.farcaster.xyz/docs/guides/notifications

    switch (event) {
      case 'miniapp_added':
        if (notificationDetails && fid) {
          // Store notification token if provided
          await sql`
            INSERT INTO notification_tokens (fid, token, notification_url, enabled)
            VALUES (${fid}, ${notificationDetails.token}, ${notificationDetails.url}, ${!!notificationDetails.token})
            ON CONFLICT (fid, token) 
            DO UPDATE SET 
              enabled = ${!!notificationDetails.token},
              updated_at = NOW()
          `;
          console.log('[webhooks/notifications] Stored token for miniapp_added event, fid:', fid);
        }
        break;

      case 'miniapp_removed':
        if (fid) {
          // Mark all tokens for this FID as disabled
          await sql`
            UPDATE notification_tokens
            SET enabled = false, updated_at = NOW()
            WHERE fid = ${fid}
          `;
          console.log('[webhooks/notifications] Disabled tokens for miniapp_removed event, fid:', fid);
        }
        break;

      case 'notifications_enabled':
        if (notificationDetails && fid) {
          // Store/update notification token and enable
          await sql`
            INSERT INTO notification_tokens (fid, token, notification_url, enabled)
            VALUES (${fid}, ${notificationDetails.token}, ${notificationDetails.url}, true)
            ON CONFLICT (fid, token)
            DO UPDATE SET
              enabled = true,
              updated_at = NOW()
          `;
          console.log('[webhooks/notifications] Enabled notifications, fid:', fid);
        }
        break;

      case 'notifications_disabled':
        if (fid) {
          // Disable all tokens for this FID
          await sql`
            UPDATE notification_tokens
            SET enabled = false, updated_at = NOW()
            WHERE fid = ${fid}
          `;
          console.log('[webhooks/notifications] Disabled notifications, fid:', fid);
        }
        break;

      default:
        console.warn('[webhooks/notifications] Unknown event type:', event);
    }

    // Always return 200 OK - required by Farcaster spec
    // If we don't return 200, the client may retry
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error('[webhooks/notifications] Error processing webhook:', err);
    // Still return 200 to prevent retries on our errors
    // Log the error for debugging
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 200 }
    );
  }
}

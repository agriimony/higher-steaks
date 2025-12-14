import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import {
  ParseWebhookEvent,
  parseWebhookEvent,
  verifyAppKeyWithNeynar,
} from '@farcaster/miniapp-node';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Read the raw request body as text for verification
    const requestText = await request.text();
    console.log('[webhooks/notifications] Raw request body:', requestText);
    
    const requestJson = JSON.parse(requestText);
    console.log('[webhooks/notifications] Parsed request JSON:', JSON.stringify(requestJson, null, 2));
    console.log('[webhooks/notifications] Request JSON keys:', Object.keys(requestJson));
    console.log('[webhooks/notifications] requestJson.event:', requestJson.event);
    console.log('[webhooks/notifications] requestJson.notificationDetails:', requestJson.notificationDetails);

    // Verify and parse the webhook event
    // This extracts the fid from the signature and validates the event
    let parsedData;
    try {
      parsedData = await parseWebhookEvent(requestJson, verifyAppKeyWithNeynar);
      console.log('[webhooks/notifications] Parsed data:', JSON.stringify(parsedData, null, 2));
      console.log('[webhooks/notifications] Parsed data keys:', Object.keys(parsedData));
      console.log('[webhooks/notifications] parsedData.fid:', parsedData.fid);
      console.log('[webhooks/notifications] parsedData.event:', (parsedData as any).event);
    } catch (e: unknown) {
      const error = e as ParseWebhookEvent.ErrorType;
      console.error('[webhooks/notifications] Verification error details:', {
        name: error.name,
        message: (error as any).message,
        error: JSON.stringify(error, null, 2),
      });
      
      switch (error.name) {
        case 'VerifyJsonFarcasterSignature.InvalidDataError':
        case 'VerifyJsonFarcasterSignature.InvalidEventDataError':
          console.error('[webhooks/notifications] Invalid request data:', error);
          // Return 200 to prevent retries, but log the error
          return NextResponse.json(
            { success: false, error: 'Invalid request data' },
            { status: 200 }
          );
        case 'VerifyJsonFarcasterSignature.InvalidAppKeyError':
          console.error('[webhooks/notifications] Invalid app key:', error);
          return NextResponse.json(
            { success: false, error: 'Invalid app key' },
            { status: 200 }
          );
        case 'VerifyJsonFarcasterSignature.VerifyAppKeyError':
          console.error('[webhooks/notifications] Error verifying app key:', error);
          // This might be a transient error, caller may want to retry
          // But we still return 200 to prevent infinite retries
          return NextResponse.json(
            { success: false, error: 'Verification error' },
            { status: 200 }
          );
        default:
          console.error('[webhooks/notifications] Unknown verification error:', error);
          return NextResponse.json(
            { success: false, error: 'Verification failed' },
            { status: 200 }
          );
      }
    }

    // Extract data from verified event
    // The parsedData contains the verified fid, and we can safely read event data from the original request
    const fid = parsedData.fid;
    
    // Try multiple possible paths for event data
    const eventType = requestJson.event 
      || (requestJson as any).event?.event 
      || (parsedData as any).event 
      || (parsedData as any).event?.event;
    
    const notificationDetails = requestJson.notificationDetails 
      || (requestJson as any).event?.notificationDetails
      || (parsedData as any).notificationDetails
      || (parsedData as any).event?.notificationDetails;

    console.log('[webhooks/notifications] Extracted values:', {
      fid,
      eventType,
      notificationDetails,
      'requestJson.event': requestJson.event,
      'requestJson.notificationDetails': requestJson.notificationDetails,
      'parsedData keys': Object.keys(parsedData),
    });

    if (!fid) {
      console.warn('[webhooks/notifications] Missing fid in verified event');
      return NextResponse.json(
        { success: false, error: 'Missing fid' },
        { status: 200 }
      );
    }

    if (!eventType) {
      console.warn('[webhooks/notifications] Missing event type in verified event');
      return NextResponse.json(
        { success: false, error: 'Missing event type' },
        { status: 200 }
      );
    }

    // Process the verified event
    // Now that we've verified the signature and extracted the fid, we can safely process the event
    switch (eventType) {
      case 'miniapp_added':
        if (notificationDetails) {
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
        // Mark all tokens for this FID as disabled
        await sql`
          UPDATE notification_tokens
          SET enabled = false, updated_at = NOW()
          WHERE fid = ${fid}
        `;
        console.log('[webhooks/notifications] Disabled tokens for miniapp_removed event, fid:', fid);
        break;

      case 'notifications_enabled':
        if (notificationDetails) {
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
        // Disable all tokens for this FID
        await sql`
          UPDATE notification_tokens
          SET enabled = false, updated_at = NOW()
          WHERE fid = ${fid}
        `;
        console.log('[webhooks/notifications] Disabled notifications, fid:', fid);
        break;

      default:
        console.warn('[webhooks/notifications] Unknown event type:', eventType);
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

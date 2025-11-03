import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Import contract addresses to filter events
import { LOCKUP_CONTRACT, HIGHER_TOKEN_ADDRESS } from '@/lib/contracts';
import { eventStore } from '@/lib/event-store';

// Broadcast event to all connected SSE clients
function broadcastEvent(type: string, data: any) {
  const event = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type: type as 'lockup_created' | 'unlock' | 'transfer',
    data,
  };
  
  // Keep only last 100 events
  eventStore.events.push(event);
  if (eventStore.events.length > 100) {
    eventStore.events.shift();
  }
  
  // Notify all subscribers
  eventStore.subscriptions.forEach((notify) => notify());
}

// Verify webhook signature from CDP
function verifySignature(payload: string, signature: string | null): boolean {
  if (!signature) {
    return false;
  }
  
  const secret = process.env.CDP_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[CDP Webhook] CDP_WEBHOOK_SECRET not configured');
    return false;
  }
  
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const digest = hmac.digest('hex');
  
  return signature === digest;
}

// Parse and normalize event data from CDP
function parseCDPEvent(body: any): { type: string; data: any } | null {
  try {
    // CDP webhook payload structure (based on CDP docs)
    const eventType = body.eventTypes?.[0];
    const labels = body.labels || {};
    const data = body.data || {};
    
    if (eventType !== 'onchain.activity.detected') {
      console.log('[CDP Webhook] Ignoring non-onchain event:', eventType);
      return null;
    }
    
    const contractAddress = labels.contract_address?.toLowerCase();
    const eventName = labels.event_name;
    
    console.log('[CDP Webhook] Received event:', {
      contractAddress,
      eventName,
      labels,
    });
    
    // Handle LockUpCreated events
    if (contractAddress === LOCKUP_CONTRACT.toLowerCase() && eventName === 'LockUpCreated') {
      // CDP should provide decoded event parameters in the payload
      // Adjust field names based on actual CDP response structure
      return {
        type: 'lockup_created',
        data: {
          lockUpId: data.lockUpId || data.lockup_id,
          token: data.token,
          receiver: data.receiver,
          amount: data.amount,
          unlockTime: data.unlockTime || data.unlock_time,
          title: data.title,
        },
      };
    }
    
    // Handle Unlock events
    if (contractAddress === LOCKUP_CONTRACT.toLowerCase() && eventName === 'Unlock') {
      return {
        type: 'unlock',
        data: {
          lockUpId: data.lockUpId || data.lockup_id,
          token: data.token,
          receiver: data.receiver,
        },
      };
    }
    
    // Handle Transfer events (HIGHER token)
    if (contractAddress === HIGHER_TOKEN_ADDRESS.toLowerCase() && eventName === 'Transfer') {
      return {
        type: 'transfer',
        data: {
          from: data.from,
          to: data.to,
          value: data.value,
        },
      };
    }
    
    console.log('[CDP Webhook] Event not handled:', { contractAddress, eventName });
    return null;
  } catch (error) {
    console.error('[CDP Webhook] Error parsing event:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get raw body for signature verification
    const bodyText = await request.text();
    const body = JSON.parse(bodyText);
    
    // Verify signature
    const signature = request.headers.get('x-cdp-signature');
    if (!verifySignature(bodyText, signature)) {
      console.error('[CDP Webhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    
    console.log('[CDP Webhook] Received verified webhook:', JSON.stringify(body, null, 2));
    
    // Parse and broadcast event
    const parsedEvent = parseCDPEvent(body);
    if (parsedEvent) {
      console.log('[CDP Webhook] Broadcasting event:', parsedEvent.type);
      broadcastEvent(parsedEvent.type, parsedEvent.data);
    }
    
    return NextResponse.json({ success: true, message: 'Event received' });
  } catch (error) {
    console.error('[CDP Webhook] Error processing webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}



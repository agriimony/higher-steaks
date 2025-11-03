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
// CDP uses X-Hook0-Signature header with format: t=timestamp,h=headers,v1=signature
function verifySignature(payload: string, signatureHeader: string | null, headers: Record<string, string>, secrets: string[]): boolean {
  if (!signatureHeader) {
    console.error('[CDP Webhook] No signature header provided');
    return false;
  }
  
  if (secrets.length === 0) {
    console.error('[CDP Webhook] No webhook secrets configured');
    return false;
  }
  
  try {
    // Parse the signature header: t=timestamp,h=headers,v0=signature or v1=signature
    const elements = signatureHeader.split(',');
    const timestampMatch = elements.find((e: string) => e.startsWith('t='));
    const headerNamesMatch = elements.find((e: string) => e.startsWith('h='));
    const providedSignatureMatchV1 = elements.find((e: string) => e.startsWith('v1='));
    const providedSignatureMatchV0 = elements.find((e: string) => e.startsWith('v0='));
    const providedSignatureMatch = providedSignatureMatchV1 || providedSignatureMatchV0;
    
    if (!timestampMatch || !headerNamesMatch || !providedSignatureMatch) {
      console.error('[CDP Webhook] Malformed signature header');
      return false;
    }
    
    const timestamp = timestampMatch.split('=')[1];
    const headerNames = headerNamesMatch.split('=')[1];
    const providedSignature = providedSignatureMatch.split('=')[1];
    
    // Build the header values string
    const headerNameList = headerNames.split(' ');
    const headerValues = headerNameList.map((name: string) => headers[name.toLowerCase()] || '').join('.');
    
    // Construct the signed payload
    const signedPayload = `${timestamp}.${headerNames}.${headerValues}.${payload}`;
    
    console.log('[CDP Webhook Debug] Header names:', headerNames);
    console.log('[CDP Webhook Debug] Header values:', headerValues);
    console.log('[CDP Webhook Debug] Signed payload preview:', signedPayload.substring(0, 300));
    console.log('[CDP Webhook Debug] Trying', secrets.length, 'secrets...');
    
    // Try each secret until one matches
    const providedBuffer = Buffer.from(providedSignature, 'hex');
    
    for (let i = 0; i < secrets.length; i++) {
      const secret = secrets[i];
      console.log(`[CDP Webhook Debug] Trying secret ${i + 1}/${secrets.length}, length: ${secret.length}`);
      
      try {
        // Compute the expected signature
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(signedPayload, 'utf8');
        const expectedSignature = hmac.digest('hex');
        
        const expectedBuffer = Buffer.from(expectedSignature, 'hex');
        
        if (expectedBuffer.length !== providedBuffer.length) {
          console.log(`[CDP Webhook Debug] Secret ${i + 1}: length mismatch`);
          continue;
        }
        
        const signaturesMatch = crypto.timingSafeEqual(expectedBuffer, providedBuffer);
        
        if (signaturesMatch) {
          console.log(`[CDP Webhook Debug] Secret ${i + 1} matched!`);
          
          // Verify the timestamp to prevent replay attacks (within 5 minutes)
          const webhookTime = parseInt(timestamp) * 1000;
          const currentTime = Date.now();
          const ageMinutes = (currentTime - webhookTime) / (1000 * 60);
          
          if (ageMinutes > 5) {
            console.error(`[CDP Webhook] Webhook timestamp too old: ${ageMinutes.toFixed(1)} minutes`);
            return false;
          }
          
          return true;
        }
      } catch (error) {
        console.log(`[CDP Webhook Debug] Secret ${i + 1}: error:`, error);
      }
    }
    
    console.error('[CDP Webhook] No matching secret found');
    return false;
  } catch (error) {
    console.error('[CDP Webhook] Signature verification error:', error);
    return false;
  }
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
    
    // Log all headers for debugging
    const allHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      allHeaders[key] = value;
    });
    console.log('[CDP Webhook] All headers:', JSON.stringify(allHeaders, null, 2));
    
    // Verify signature using X-Hook0-Signature header
    const signatureHeader = request.headers.get('x-hook0-signature') || request.headers.get('X-Hook0-Signature');
    console.log('[CDP Webhook] Signature header:', signatureHeader);
    console.log('[CDP Webhook] Payload length:', bodyText.length);
    
    // Collect all webhook secrets (one per subscription)
    const webhookSecrets = [
      process.env.CDP_WEBHOOK_SECRET_1,
      process.env.CDP_WEBHOOK_SECRET_2,
      process.env.CDP_WEBHOOK_SECRET_3,
    ].filter(Boolean) as string[];
    
    if (webhookSecrets.length === 0) {
      console.error('[CDP Webhook] No webhook secrets configured');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }
    
    if (!verifySignature(bodyText, signatureHeader, allHeaders, webhookSecrets)) {
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



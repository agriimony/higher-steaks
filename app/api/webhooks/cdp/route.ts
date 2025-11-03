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
    // CDP webhook payload is a flat structure with event details at the top level
    const contractAddress = body.contract_address?.toLowerCase();
    const eventName = body.event_name;
    const parameters = body.parameters || {};
    
    console.log('[CDP Webhook] Received event:', {
      contractAddress,
      eventName,
      transactionHash: body.transaction_hash,
    });
    
    // Handle LockUpCreated events
    if (contractAddress === LOCKUP_CONTRACT.toLowerCase() && eventName === 'LockUpCreated') {
      return {
        type: 'lockup_created',
        data: {
          lockUpId: parameters.lockUpId || parameters.lockup_id,
          token: parameters.token,
          receiver: parameters.receiver,
          amount: parameters.amount,
          unlockTime: parameters.unlockTime || parameters.unlock_time,
          title: parameters.title,
        },
      };
    }
    
    // Handle Unlock events
    if (contractAddress === LOCKUP_CONTRACT.toLowerCase() && eventName === 'Unlock') {
      return {
        type: 'unlock',
        data: {
          lockUpId: parameters.lockUpId || parameters.lockup_id,
          token: parameters.token,
          receiver: parameters.receiver,
        },
      };
    }
    
    // Handle Transfer events (HIGHER token)
    if (contractAddress === HIGHER_TOKEN_ADDRESS.toLowerCase() && eventName === 'Transfer') {
      const from = (parameters.from || '').toLowerCase();
      const to = (parameters.to || '').toLowerCase();
      const lockupContract = LOCKUP_CONTRACT.toLowerCase();
      
      // Determine if this is a lock or unlock event based on transfer direction
      let eventType: 'lockup_created' | 'unlock' | 'transfer' = 'transfer';
      
      if (to === lockupContract) {
        // Transfer TO lockup contract = lock (stake)
        eventType = 'lockup_created';
        console.log('[CDP Webhook] Detected lockup via Transfer event');
      } else if (from === lockupContract) {
        // Transfer FROM lockup contract = unlock (unstake)
        eventType = 'unlock';
        console.log('[CDP Webhook] Detected unlock via Transfer event');
      }
      
      return {
        type: eventType,
        data: {
          from: parameters.from,
          to: parameters.to,
          value: parameters.value,
          // For lockup_created and unlock, we won't have lockUpId from Transfer events
          // The frontend will need to refetch lockup details
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
    
    // Verify signature using X-Hook0-Signature header
    const allHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      allHeaders[key] = value;
    });
    
    const signatureHeader = request.headers.get('x-hook0-signature') || request.headers.get('X-Hook0-Signature');
    console.log('[CDP Webhook] Payload length:', bodyText.length);
    
    // Determine which secret to use based on event type
    // CDP payload has flat structure with event details at top level
    const eventName = body.event_name;
    const contractAddress = body.contract_address?.toLowerCase();
    
    console.log('[CDP Webhook] Event:', eventName, 'Contract:', contractAddress);
    
    let webhookSecret: string | undefined;
    
    if (contractAddress === LOCKUP_CONTRACT.toLowerCase()) {
      // LockUpCreated or Unlock event - use lockup secret
      webhookSecret = process.env.CDP_WEBHOOK_SECRET_LOCKUP;
      console.log('[CDP Webhook] Using lockup secret');
    } else if (contractAddress === HIGHER_TOKEN_ADDRESS.toLowerCase() && eventName === 'Transfer') {
      // Transfer event - use transfer secret
      webhookSecret = process.env.CDP_WEBHOOK_SECRET_TRANSFER;
      console.log('[CDP Webhook] Using transfer secret');
    }
    
    // Collect all secrets for verification (we'll try the specific one first if known)
    const allSecrets = [
      process.env.CDP_WEBHOOK_SECRET_LOCKUP,
      process.env.CDP_WEBHOOK_SECRET_TRANSFER,
    ].filter(Boolean) as string[];
    
    if (allSecrets.length === 0) {
      console.error('[CDP Webhook] No webhook secrets configured');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }
    
    // Verify signature - try specific secret first if we identified it, otherwise try all
    const secretsToTry = webhookSecret ? [webhookSecret] : allSecrets;
    if (!verifySignature(bodyText, signatureHeader, allHeaders, secretsToTry)) {
      console.error('[CDP Webhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    
    // Parse and broadcast event
    const parsedEvent = parseCDPEvent(body);
    if (parsedEvent) {
      console.log('[CDP Webhook] Broadcasting event:', parsedEvent.type, parsedEvent.data);
      broadcastEvent(parsedEvent.type, parsedEvent.data);
    }
    
    return NextResponse.json({ success: true, message: 'Event received' });
  } catch (error) {
    console.error('[CDP Webhook] Error processing webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}



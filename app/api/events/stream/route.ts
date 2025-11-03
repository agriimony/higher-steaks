import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { eventStore } from '@/lib/event-store';

// Force Node.js runtime for SSE support
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Keep track of clients for broadcasting
let clients: Map<string, ReadableStreamDefaultController> = new Map();

// Broadcast updates when new events arrive
eventStore.subscriptions.set('SSE_BROADCASTER', () => {
  const data = JSON.stringify(eventStore.events.slice(-1)); // Send only latest event
  clients.forEach((controller) => {
    try {
      controller.enqueue(`data: ${data}\n\n`);
    } catch (error) {
      console.error('[SSE] Error broadcasting to client:', error);
    }
  });
});

export async function GET(request: NextRequest) {
  const clientId = crypto.randomUUID();
  
  // Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      clients.set(clientId, controller);
      
      // Send initial connection message
      controller.enqueue(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);
      
      // Keep connection alive with periodic pings
      const keepaliveInterval = setInterval(() => {
        try {
          controller.enqueue(`: keepalive\n\n`);
        } catch (error) {
          clearInterval(keepaliveInterval);
          clients.delete(clientId);
        }
      }, 30000); // Every 30 seconds
      
      // Store interval for cleanup
      (controller as any)._keepaliveInterval = keepaliveInterval;
    },
    
    cancel() {
      // Cleanup on client disconnect
      const controller = clients.get(clientId);
      if (controller && (controller as any)._keepaliveInterval) {
        clearInterval((controller as any)._keepaliveInterval);
      }
      clients.delete(clientId);
    },
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}


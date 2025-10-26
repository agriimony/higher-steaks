import { NextRequest } from 'next/server';
import { getNeynarClient } from '@/lib/neynar';

/**
 * GET /api/ingest/higher/stream
 * Streams matching casts from /higher channel in real-time
 */
export async function GET(request: NextRequest) {
  try {
    const client = getNeynarClient();
    const { searchParams } = new URL(request.url);
    const pattern = searchParams.get('pattern') || '^i want to aim higher';
    
    console.log(`Starting stream for /higher channel with pattern: ${pattern}`);
    
    // Set up SSE (Server-Sent Events) for streaming
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let lastCheckedHash = '';
        
        // Poll for new casts every 10 seconds
        const pollInterval = setInterval(async () => {
          try {
            const response = await client.fetchCasts({
              parentChannel: 'higher',
              limit: 25, // Check last 25 casts
            });
            
            if (!response.result.casts) return;
            
            // Filter for matching casts
            const regex = new RegExp(pattern, 'i');
            const matchingCasts = response.result.casts.filter((cast: any) => {
              const text = cast.text?.toLowerCase() || '';
              return regex.test(text);
            });
            
            // Only send new casts (check hash to avoid duplicates)
            const newCasts = matchingCasts.filter((cast: any) => {
              if (cast.hash === lastCheckedHash) return false;
              return true;
            });
            
            if (newCasts.length > 0) {
              console.log(`Found ${newCasts.length} new matching casts`);
              
              const data = JSON.stringify({
                timestamp: new Date().toISOString(),
                casts: newCasts,
              });
              
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
              
              // Update last checked hash
              if (newCasts[0]?.hash) {
                lastCheckedHash = newCasts[0].hash;
              }
            }
          } catch (error) {
            console.error('Stream poll error:', error);
          }
        }, 10000); // Poll every 10 seconds
        
        // Clean up on close
        request.signal.addEventListener('abort', () => {
          console.log('Stream closed');
          clearInterval(pollInterval);
          controller.close();
        });
      },
    });
    
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
    
  } catch (error: any) {
    console.error('Stream error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}


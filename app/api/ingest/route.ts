import { NextRequest, NextResponse } from 'next/server';
import { getNeynarClient } from '@/lib/neynar';

/**
 * POST /api/ingest
 * Ingests Farcaster data from Neynar based on query parameters
 */
export async function POST(request: NextRequest) {
  try {
    const client = getNeynarClient();
    const body = await request.json();
    
    const { type, params } = body;
    
    let data;
    
    switch (type) {
      case 'casts':
        // Fetch recent casts
        data = await fetchRecentCasts(client, params);
        break;
        
      case 'user':
        // Fetch user profile
        data = await fetchUser(client, params);
        break;
        
      case 'channel':
        // Fetch channel data
        data = await fetchChannel(client, params);
        break;
        
      default:
        return NextResponse.json(
          { error: 'Invalid ingestion type' },
          { status: 400 }
        );
    }
    
    // TODO: Store data in database
    
    return NextResponse.json({ success: true, data });
    
  } catch (error: any) {
    console.error('Ingestion error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to ingest data' },
      { status: 500 }
    );
  }
}

// Helper functions for different data types
async function fetchRecentCasts(client: any, params: any) {
  const { limit = 25, cursor } = params;
  // Fetch casts using Neynar API
  const response = await client.fetchCasts({
    limit,
    ...(cursor && { cursor }),
  });
  
  return response;
}

async function fetchUser(client: any, params: any) {
  const { fid } = params;
  
  if (!fid) {
    throw new Error('FID (Farcaster ID) is required');
  }
  
  const response = await client.lookupUserByFid(parseInt(fid));
  return response;
}

async function fetchChannel(client: any, params: any) {
  const { id } = params;
  
  if (!id) {
    throw new Error('Channel ID is required');
  }
  
  const response = await client.fetchChannel(id);
  return response;
}


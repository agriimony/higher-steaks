import { NextRequest, NextResponse } from 'next/server';

// Force Node.js runtime
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // Get FID from query parameter
    const searchParams = request.nextUrl.searchParams;
    const fidParam = searchParams.get('fid');
    
    if (!fidParam) {
      return NextResponse.json(
        { error: 'FID is required' },
        { status: 400 }
      );
    }

    const fid = parseInt(fidParam, 10);
    
    if (isNaN(fid)) {
      return NextResponse.json(
        { error: 'Invalid FID' },
        { status: 400 }
      );
    }

    // Check if Neynar API key is available
    const neynarApiKey = process.env.NEYNAR_API_KEY;
    
    if (!neynarApiKey || neynarApiKey === 'your_neynar_api_key_here') {
      // Return mock data when Neynar API key is not configured
      console.warn('Neynar API key not configured, returning mock data');
      return NextResponse.json({
        fid,
        username: 'demo_user',
        displayName: 'Demo User',
        pfpUrl: 'https://via.placeholder.com/150',
        walletAddress: '0x0000000000000000000000000000000000000000',
        bio: 'Neynar API key not configured',
      });
    }

    // Lazy import Neynar SDK to avoid client-side bundling
    const { NeynarAPIClient } = await import('@neynar/nodejs-sdk');
    const neynarClient = new NeynarAPIClient(neynarApiKey);
    
    // Fetch user profile from Neynar
    try {
      const userResponse = await neynarClient.fetchBulkUsers([fid]);
      const user = userResponse.users[0];

      if (!user) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }

      // Extract verified Ethereum address (primary custody or verified address)
      const walletAddress = user.verified_addresses?.eth_addresses?.[0] || 
                           user.custody_address || 
                           null;

      return NextResponse.json({
        fid: user.fid,
        username: user.username,
        displayName: user.display_name || user.username,
        pfpUrl: user.pfp_url || '',
        walletAddress,
        bio: user.profile?.bio?.text || '',
      });
    } catch (neynarError) {
      console.error('Neynar API error:', neynarError);
      return NextResponse.json(
        { error: 'Failed to fetch user profile from Neynar' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Profile API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


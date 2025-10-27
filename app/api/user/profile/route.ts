import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@farcaster/quick-auth';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';

const quickAuthClient = createClient();

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { error: 'Token is required' },
        { status: 400 }
      );
    }

    // Verify the JWT token
    let payload;
    try {
      payload = await quickAuthClient.verifyJwt({
        token,
        domain: process.env.VERCEL_URL || 'higher-steaks.vercel.app',
      });
    } catch (error) {
      console.error('JWT verification failed:', error);
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    const fid = payload.sub; // FID is in the 'sub' field of the JWT

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

    // Fetch user profile from Neynar
    try {
      const neynarClient = new NeynarAPIClient(neynarApiKey);
      
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


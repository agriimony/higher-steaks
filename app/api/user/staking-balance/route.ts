import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';

// Force Node.js runtime
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Mint.club Lockup contract address on Base
const LOCKUP_CONTRACT = '0xA3dCf3Ca587D9929d540868c924f208726DC9aB6';
const HIGHER_TOKEN = '0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe';

// Minimal ABI for the lockup contract
const LOCKUP_ABI = [
  {
    inputs: [],
    name: 'lockUpCount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'start', type: 'uint256' },
      { name: 'stop', type: 'uint256' },
    ],
    name: 'getLockUpIdsByToken',
    outputs: [{ name: '', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'id', type: 'uint256' }],
    name: 'lockUps',
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'isERC20', type: 'bool' },
      { name: 'unlockTime', type: 'uint256' },
      { name: 'unlocked', type: 'bool' },
      { name: 'amount', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'title', type: 'string' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export async function GET(request: NextRequest) {
  try {
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

    // Fetch user profile from Neynar to get verified addresses
    const neynarApiKey = process.env.NEYNAR_API_KEY;

    if (!neynarApiKey) {
      return NextResponse.json({
        totalStaked: '0',
        totalStakedFormatted: '0.00',
        addresses: [],
        error: 'Neynar API key not configured',
      });
    }

    // Lazy import Neynar SDK
    const { NeynarAPIClient } = await import('@neynar/nodejs-sdk');
    const neynarClient = new NeynarAPIClient({ apiKey: neynarApiKey });

    const userResponse = await neynarClient.fetchBulkUsers({ fids: [fid] });
    const user = userResponse.users[0];

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Get all verified Ethereum addresses
    const verifiedAddresses = user.verified_addresses?.eth_addresses || [];
    
    if (verifiedAddresses.length === 0) {
      return NextResponse.json({
        totalStaked: '0',
        totalStakedFormatted: '0.00',
        addresses: [],
        message: 'No verified addresses found',
      });
    }

    // Create Base RPC client
    const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    const baseClient = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    });

    // Get total lockup count
    const totalLockups = await baseClient.readContract({
      address: LOCKUP_CONTRACT,
      abi: LOCKUP_ABI,
      functionName: 'lockUpCount',
    }) as bigint;

    if (totalLockups === 0n) {
      return NextResponse.json({
        totalStaked: '0',
        totalStakedFormatted: '0.00',
        addresses: [],
      });
    }

    // Get all HIGHER lockup IDs
    const higherLockupIds = await baseClient.readContract({
      address: LOCKUP_CONTRACT,
      abi: LOCKUP_ABI,
      functionName: 'getLockUpIdsByToken',
      args: [HIGHER_TOKEN, 1n, totalLockups],
    }) as bigint[];

    // Sum staked amounts for user's addresses
    let totalStaked = 0n;
    const userAddressesLower = verifiedAddresses.map(addr => addr.toLowerCase());

    for (const lockupId of higherLockupIds) {
      try {
        const lockup = await baseClient.readContract({
          address: LOCKUP_CONTRACT,
          abi: LOCKUP_ABI,
          functionName: 'lockUps',
          args: [lockupId],
        }) as readonly [string, boolean, number, boolean, bigint, string, string];
        
        const [token, isERC20, unlockTime, unlocked, amount, receiver, title] = lockup;
        
        // Only count active (not unlocked) lockups for this user
        if (!unlocked && userAddressesLower.includes(receiver.toLowerCase())) {
          totalStaked += amount;
        }
      } catch (error) {
        console.error(`Error fetching lockup ${lockupId}:`, error);
        // Continue with other lockups
      }
    }

    const totalStakedFormatted = parseFloat(formatUnits(totalStaked, 18)).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return NextResponse.json({
      totalStaked: totalStaked.toString(),
      totalStakedFormatted,
      addresses: verifiedAddresses,
    });
  } catch (error) {
    console.error('Staking balance API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


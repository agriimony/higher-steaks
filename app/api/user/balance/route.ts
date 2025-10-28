import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';

// Force Node.js runtime
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// HIGHER token contract address on Base
const HIGHER_TOKEN_ADDRESS = '0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe';

// Minimal ERC-20 ABI for balanceOf
const ERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
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

    if (!neynarApiKey || neynarApiKey === 'your_neynar_api_key_here') {
      console.warn('Neynar API key not configured');
      return NextResponse.json({
        totalBalance: '0',
        totalBalanceFormatted: '0.00',
        usdValue: '$0.00',
        pricePerToken: 0,
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
        totalBalance: '0',
        totalBalanceFormatted: '0.00',
        usdValue: '$0.00',
        pricePerToken: 0,
        addresses: [],
        message: 'No verified addresses found',
      });
    }

    // Create Base RPC client
    const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    const client = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    });

    // Fetch balances for all verified addresses
    const addressBalances = await Promise.all(
      verifiedAddresses.map(async (address) => {
        try {
          const balance = await client.readContract({
            address: HIGHER_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [address as `0x${string}`],
          });

          const balanceFormatted = formatUnits(balance, 18);

          return {
            address,
            balance: balance.toString(),
            balanceFormatted: parseFloat(balanceFormatted).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }),
          };
        } catch (error) {
          console.error(`Error fetching balance for ${address}:`, error);
          return {
            address,
            balance: '0',
            balanceFormatted: '0.00',
          };
        }
      })
    );

    // Sum total balances
    const totalBalance = addressBalances.reduce(
      (sum, item) => sum + BigInt(item.balance),
      BigInt(0)
    );

    const totalBalanceFormatted = parseFloat(formatUnits(totalBalance, 18)).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    // Fetch HIGHER token price from CoinGecko
    let pricePerToken = 0;
    let usdValue = '$0.00';

    try {
      const priceResponse = await fetch(
        `https://api.coingecko.com/api/v3/simple/token_price/base?contract_addresses=${HIGHER_TOKEN_ADDRESS}&vs_currencies=usd`,
        {
          next: { revalidate: 300 }, // Cache for 5 minutes
        }
      );

      if (priceResponse.ok) {
        const priceData = await priceResponse.json();
        pricePerToken = priceData[HIGHER_TOKEN_ADDRESS.toLowerCase()]?.usd || 0;

        const totalTokens = parseFloat(formatUnits(totalBalance, 18));
        const usdAmount = totalTokens * pricePerToken;
        usdValue = `$${usdAmount.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      }
    } catch (priceError) {
      console.error('Error fetching token price:', priceError);
    }

    return NextResponse.json({
      totalBalance: totalBalance.toString(),
      totalBalanceFormatted,
      usdValue,
      pricePerToken,
      addresses: addressBalances,
    });
  } catch (error) {
    console.error('Balance API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


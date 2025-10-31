import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits, type PublicClient } from 'viem';
import { base } from 'viem/chains';

// Force Node.js runtime
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// HIGHER token contract address on Base
const HIGHER_TOKEN_ADDRESS = '0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe';

// Lockup contract address on Base
const LOCKUP_CONTRACT = '0xA3dCf3Ca587D9929d540868c924f208726DC9aB6';

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

// Lockup contract ABI
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
      { name: 'receiver', type: 'address' },
      { name: 'start', type: 'uint256' },
      { name: 'stop', type: 'uint256' },
    ],
    name: 'getLockUpIdsByReceiver',
    outputs: [{ name: 'ids', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '', type: 'uint256' }],
    name: 'lockUps',
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'isERC20', type: 'bool' },
      { name: 'unlockTime', type: 'uint40' },
      { name: 'unlocked', type: 'bool' },
      { name: 'amount', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'title', type: 'string' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Fetch detailed lockup data for a given address
async function fetchDetailedLockups(
  client: PublicClient,
  address: `0x${string}`,
  currentTime: number
): Promise<Array<{
  lockupId: string;
  amount: string;
  amountFormatted: string;
  unlockTime: number;
  timeRemaining: number;
  receiver: string;
}>> {
  const lockups: Array<{
    lockupId: string;
    amount: string;
    amountFormatted: string;
    unlockTime: number;
    timeRemaining: number;
    receiver: string;
  }> = [];

  try {
    // Get total lockup count
    const lockUpCount = await client.readContract({
      address: LOCKUP_CONTRACT,
      abi: LOCKUP_ABI,
      functionName: 'lockUpCount',
    });

    if (lockUpCount === BigInt(0)) {
      return lockups;
    }

    // Get all lockup IDs for this receiver
    const lockUpIds = await client.readContract({
      address: LOCKUP_CONTRACT,
      abi: LOCKUP_ABI,
      functionName: 'getLockUpIdsByReceiver',
      args: [address, BigInt(0), lockUpCount],
    });

    // Fetch details for each lockup
    const lockUpPromises = lockUpIds.map(async (id: bigint) => {
      try {
        const lockUp = await client.readContract({
          address: LOCKUP_CONTRACT,
          abi: LOCKUP_ABI,
          functionName: 'lockUps',
          args: [id],
        });

        return { id, lockUp };
      } catch (error) {
        console.error(`Error fetching lockup ${id}:`, error);
        return null;
      }
    });

    const lockUpResults = await Promise.all(lockUpPromises);

    // Filter and process HIGHER token lockups
    for (const result of lockUpResults) {
      if (!result) continue;

      const { id, lockUp } = result;
      // Destructure tuple: [token, isERC20, unlockTime, unlocked, amount, receiver, title]
      const [token, isERC20, unlockTime, unlocked, amount, receiver] = lockUp;
      const tokenAddress = (token as string).toLowerCase();
      const unlockTimeNum = Number(unlockTime);

      // Filter for HIGHER token ERC20 lockups
      if (tokenAddress === HIGHER_TOKEN_ADDRESS.toLowerCase() && isERC20) {
        const timeRemaining = unlockTimeNum - currentTime;
        
        // Only include lockups that haven't been unlocked yet
        if (!(unlocked as boolean)) {
          lockups.push({
            lockupId: id.toString(),
            amount: (amount as bigint).toString(),
            amountFormatted: parseFloat(formatUnits(amount as bigint, 18)).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }),
            unlockTime: unlockTimeNum,
            timeRemaining,
            receiver: receiver as string,
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error fetching detailed lockups for ${address}:`, error);
  }

  // Sort by unlockTime (soonest first)
  lockups.sort((a, b) => a.unlockTime - b.unlockTime);

  return lockups;
}

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
        lockups: [],
        wallets: [],
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
        lockups: [],
        wallets: [],
        message: 'No verified addresses found',
      });
    }

    // Create Base RPC client
    const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    const client = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    });

    // Get current timestamp once
    const currentBlock = await client.getBlockNumber();
    const block = await client.getBlock({ 
      blockNumber: currentBlock,
      includeTransactions: false 
    });
    const currentTime = Number(block.timestamp);

    // Fetch detailed lockups and wallet balances for all verified addresses in parallel
    const [allLockups, walletBalances] = await Promise.all([
      // Detailed lockups for all addresses
      Promise.all(
        verifiedAddresses.map(async (address) => {
          try {
            return await fetchDetailedLockups(client as PublicClient, address as `0x${string}`, currentTime);
          } catch (error) {
            console.error(`Error fetching lockups for ${address}:`, error);
            return [];
          }
        })
      ),
      // Wallet balances for all addresses
      Promise.all(
        verifiedAddresses.map(async (address) => {
          try {
            const balance = await client.readContract({
              address: HIGHER_TOKEN_ADDRESS,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [address as `0x${string}`],
            });

            const balanceFormatted = parseFloat(formatUnits(balance, 18)).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });

            return {
              address,
              balance: balance.toString(),
              balanceFormatted,
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
      ),
    ]);

    // Flatten lockups array (all addresses combined)
    const lockups = allLockups.flat();

    // Filter wallets to only show those with balance > 0, and format them
    const wallets = walletBalances
      .filter(w => BigInt(w.balance) > BigInt(0))
      .map(w => ({
        address: w.address,
        balance: w.balance,
        balanceFormatted: w.balanceFormatted,
      }));

    return NextResponse.json({
      lockups,
      wallets,
    });
  } catch (error) {
    console.error('Staking details API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


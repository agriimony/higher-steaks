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

// Fetch lockup data for a given address
async function fetchLockupData(
  client: PublicClient,
  address: `0x${string}`
): Promise<{ unlockedBalance: bigint; lockedBalance: bigint }> {
  let unlockedBalance = BigInt(0);
  let lockedBalance = BigInt(0);

  try {
    // Get total lockup count
    const lockUpCount = await client.readContract({
      address: LOCKUP_CONTRACT,
      abi: LOCKUP_ABI,
      functionName: 'lockUpCount',
    });

    if (lockUpCount === BigInt(0)) {
      return { unlockedBalance, lockedBalance };
    }

    // Get all lockup IDs for this receiver
    const lockUpIds = await client.readContract({
      address: LOCKUP_CONTRACT,
      abi: LOCKUP_ABI,
      functionName: 'getLockUpIdsByReceiver',
      args: [address, BigInt(0), lockUpCount],
    });

    // Get current timestamp
    const currentBlock = await client.getBlockNumber();
    const block = await client.getBlock({ 
      blockNumber: currentBlock,
      includeTransactions: false 
    }) as { timestamp: bigint };
    const currentTime = Number(block.timestamp);

    // Fetch details for each lockup
    const lockUpPromises = lockUpIds.map(async (id: bigint) => {
      try {
        const lockUp = await client.readContract({
          address: LOCKUP_CONTRACT,
          abi: LOCKUP_ABI,
          functionName: 'lockUps',
          args: [id],
        });

        return lockUp;
      } catch (error) {
        console.error(`Error fetching lockup ${id}:`, error);
        return null;
      }
    });

    const lockUps = await Promise.all(lockUpPromises);

    // Filter and sum HIGHER token lockups
    // lockUps returns a tuple: [token, isERC20, unlockTime, unlocked, amount, receiver, title]
    for (const lockUp of lockUps) {
      if (!lockUp) continue;

      // Destructure tuple: [token, isERC20, unlockTime, unlocked, amount, receiver, title]
      const [token, isERC20, unlockTime, unlocked, amount] = lockUp;
      const tokenAddress = (token as string).toLowerCase();
      const unlockTimeNum = Number(unlockTime);
      const unlockedBool = unlocked as boolean;

      // Filter for HIGHER token ERC20 lockups
      if (tokenAddress === HIGHER_TOKEN_ADDRESS.toLowerCase() && isERC20) {
        if (currentTime >= unlockTimeNum && !unlockedBool) {
          // Unlocked but not yet claimed
          unlockedBalance += amount as bigint;
        } else if (currentTime < unlockTimeNum) {
          // Still locked
          lockedBalance += amount as bigint;
        }
      }
    }
  } catch (error) {
    console.error(`Error fetching lockup data for ${address}:`, error);
  }

  return { unlockedBalance, lockedBalance };
}

// Fetch HIGHER logo from DexScreener API
async function fetchHigherLogo(): Promise<string | undefined> {
  try {
    const response = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', {
      next: { revalidate: 3600 }, // Cache for 1 hour
    });

    if (!response.ok) {
      return undefined;
    }

    const data = await response.json();
    
    // Find HIGHER token on Base chain
    const higherToken = data.find((token: any) => 
      token.chainId?.toLowerCase() === 'base' &&
      token.tokenAddress?.toLowerCase() === HIGHER_TOKEN_ADDRESS.toLowerCase()
    );

    return higherToken?.icon;
  } catch (error) {
    console.error('Error fetching HIGHER logo:', error);
    return undefined;
  }
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
        totalBalance: '0',
        totalBalanceFormatted: '0.00',
        lockedBalance: '0',
        lockedBalanceFormatted: '0.00',
        usdValue: '$0.00',
        pricePerToken: 0,
        higherLogoUrl: undefined,
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
      const higherLogo = await fetchHigherLogo();
      return NextResponse.json({
        totalBalance: '0',
        totalBalanceFormatted: '0.00',
        lockedBalance: '0',
        lockedBalanceFormatted: '0.00',
        usdValue: '$0.00',
        pricePerToken: 0,
        higherLogoUrl: higherLogo,
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

    // Fetch wallet balances and lockup data for all verified addresses in parallel
    const [addressBalances, lockupData, higherLogo] = await Promise.all([
      // Wallet balances
      Promise.all(
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
      ),
      // Lockup data for all addresses
      Promise.all(
        verifiedAddresses.map(async (address) => {
          try {
            return await fetchLockupData(client, address as `0x${string}`);
          } catch (error) {
            console.error(`Error fetching lockups for ${address}:`, error);
            return { unlockedBalance: BigInt(0), lockedBalance: BigInt(0) };
          }
        })
      ),
      // HIGHER logo
      fetchHigherLogo(),
    ]);

    // Sum wallet balances
    const walletBalance = addressBalances.reduce(
      (sum, item) => sum + BigInt(item.balance),
      BigInt(0)
    );

    // Sum lockup balances
    const unlockedLockupsBalance = lockupData.reduce(
      (sum, item) => sum + item.unlockedBalance,
      BigInt(0)
    );
    const lockedLockupsBalance = lockupData.reduce(
      (sum, item) => sum + item.lockedBalance,
      BigInt(0)
    );

    // Total balance = wallet + unlocked lockups + locked lockups
    const totalBalance = walletBalance + unlockedLockupsBalance + lockedLockupsBalance;

    const totalBalanceFormatted = parseFloat(formatUnits(totalBalance, 18)).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const lockedBalanceFormatted = parseFloat(formatUnits(lockedLockupsBalance, 18)).toLocaleString('en-US', {
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

        // Calculate USD value based on total balance (including lockups)
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
      lockedBalance: lockedLockupsBalance.toString(),
      lockedBalanceFormatted,
      usdValue,
      pricePerToken,
      higherLogoUrl: higherLogo,
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


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
        higherLogoUrl: '/higher-logo.png',
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
        lockedBalance: '0',
        lockedBalanceFormatted: '0.00',
        usdValue: '$0.00',
        pricePerToken: 0,
        higherLogoUrl: '/higher-logo.png',
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

    // Get current timestamp once (outside of fetchLockupData to avoid type issues)
    const currentBlock = await client.getBlockNumber();
    const block = await client.getBlock({ 
      blockNumber: currentBlock,
      includeTransactions: false 
    });
    const currentTime = Number(block.timestamp);

    // Fetch wallet balances for all verified addresses
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

    // Fetch detailed lockups once for all addresses (reused for totals and details)
    const allDetailedLockups = await Promise.all(
      verifiedAddresses.map(async (address) => {
        try {
          console.log(`[Balance API] Fetching lockups for address: ${address}`);
          const lockUpCount = await client.readContract({
            address: LOCKUP_CONTRACT,
            abi: LOCKUP_ABI,
            functionName: 'lockUpCount',
          });

          console.log(`[Balance API] Total lockup count: ${lockUpCount.toString()}`);

          if (lockUpCount === BigInt(0)) {
            console.log(`[Balance API] No lockups in contract for ${address}`);
            return { address, lockups: [], unlockedBalance: BigInt(0), lockedBalance: BigInt(0) };
          }

          const lockUpIds = await client.readContract({
            address: LOCKUP_CONTRACT,
            abi: LOCKUP_ABI,
            functionName: 'getLockUpIdsByReceiver',
            args: [address as `0x${string}`, BigInt(0), lockUpCount],
          });

          console.log(`[Balance API] Found ${lockUpIds.length} lockup IDs for ${address}:`, lockUpIds.map(id => id.toString()));

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
          const lockups: Array<{
            lockupId: string;
            amount: string;
            amountFormatted: string;
            unlockTime: number;
            timeRemaining: number;
            receiver: string;
          }> = [];
          
          let unlockedBalance = BigInt(0);
          let lockedBalance = BigInt(0);

          for (const result of lockUpResults) {
            if (!result) continue;
            const { id, lockUp } = result;
            const [token, isERC20, unlockTime, unlocked, amount, receiver] = lockUp;
            const tokenAddress = (token as string).toLowerCase();

            if (tokenAddress === HIGHER_TOKEN_ADDRESS.toLowerCase() && isERC20) {
              const unlockTimeNum = Number(unlockTime);
              const unlockedBool = unlocked as boolean;
              const amountBigInt = amount as bigint;

              console.log(`[Balance API] Lockup ${id.toString()}: token=${tokenAddress}, unlocked=${unlockedBool}, unlockTime=${unlockTimeNum}, amount=${amountBigInt.toString()}, receiver=${receiver as string}`);

              // Calculate totals (for balance pill)
              if (currentTime >= unlockTimeNum && !unlockedBool) {
                unlockedBalance += amountBigInt;
                console.log(`[Balance API] Added to unlocked balance: ${amountBigInt.toString()}`);
              } else if (currentTime < unlockTimeNum) {
                lockedBalance += amountBigInt;
                console.log(`[Balance API] Added to locked balance: ${amountBigInt.toString()}`);
              }

              // Store details for modal (only if not yet unlocked/claimed)
              if (!unlockedBool) {
                const timeRemaining = unlockTimeNum - currentTime;
                lockups.push({
                  lockupId: id.toString(),
                  amount: amountBigInt.toString(),
                  amountFormatted: parseFloat(formatUnits(amountBigInt, 18)).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }),
                  unlockTime: unlockTimeNum,
                  timeRemaining,
                  receiver: receiver as string,
                });
                console.log(`[Balance API] Added lockup ${id.toString()} to details array`);
              } else {
                console.log(`[Balance API] Skipped lockup ${id.toString()} - already unlocked/claimed`);
              }
            } else {
              console.log(`[Balance API] Skipped lockup ${id.toString()} - not HIGHER token or not ERC20`);
            }
          }

          lockups.sort((a, b) => a.unlockTime - b.unlockTime);
          console.log(`[Balance API] Final summary for ${address}: ${lockups.length} lockups, locked=${lockedBalance.toString()}, unlocked=${unlockedBalance.toString()}`);
          return { address, lockups, unlockedBalance, lockedBalance };
        } catch (error) {
          console.error(`[Balance API] Error fetching detailed lockups for ${address}:`, error);
          return { address, lockups: [], unlockedBalance: BigInt(0), lockedBalance: BigInt(0) };
        }
      })
    );

    console.log(`[Balance API] Total lockups found across all addresses: ${allDetailedLockups.reduce((sum, item) => sum + item.lockups.length, 0)}`);

    // Extract lockup totals and details
    const lockupData = allDetailedLockups.map(item => ({
      unlockedBalance: item.unlockedBalance,
      lockedBalance: item.lockedBalance,
    }));
    
    const allLockupsFlat = allDetailedLockups.flatMap(item => item.lockups);

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
      higherLogoUrl: '/higher-logo.png',
      addresses: addressBalances,
      lockups: allLockupsFlat,
      wallets: addressBalances.filter(w => BigInt(w.balance) > BigInt(0)).map(w => ({
        address: w.address,
        balance: w.balance,
        balanceFormatted: w.balanceFormatted,
      })),
    });
  } catch (error) {
    console.error('Balance API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


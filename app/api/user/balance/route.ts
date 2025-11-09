import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits, getAddress } from 'viem';
import { base } from 'viem/chains';

// Force Node.js runtime
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Creates a CDP (Coinbase Developer Platform) RPC client for Base network
 * Client key format: https://api.developer.coinbase.com/rpc/v1/base/{CLIENT_KEY}
 */
function createCDPClient() {
  const clientKey =
    process.env.CDP_API_KEY_ID ||
    process.env.CDP_RPC_CLIENT_KEY ||
    process.env.CDP_RPC_API_KEY ||
    '';

  const rpcUrl = clientKey
    ? `https://api.developer.coinbase.com/rpc/v1/base/${clientKey}`
    : process.env.BASE_RPC_URL || 'https://mainnet.base.org';

  if (!clientKey) {
    console.warn('[CDP] CDP client key not set, falling back to BASE_RPC_URL or public RPC');
  }

  return createPublicClient({
    chain: base,
    transport: http(rpcUrl, {
      batch: {
        wait: 10,
      },
    }),
  });
}

// Type definition for detailed lockup results
type DetailedLockupResult = {
  address: string;
  lockups: Array<{
    lockupId: string;
    amount: string;
    amountFormatted: string;
    unlockTime: number;
    receiver: string;
    title: string;
  }>;
  unlockedBalance: bigint;
  lockedBalance: bigint;
  debug: {
    lockUpIdsFound: number;
    lockupsIncluded?: number;
    message?: string;
    normalizedAddress: string;
    originalAddress: string;
  };
};

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
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const fid = parseInt(fidParam, 10);

    if (isNaN(fid)) {
      return NextResponse.json(
        { error: 'Invalid FID' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Fetch user profile from Neynar to get verified addresses
    const neynarApiKey = process.env.NEYNAR_API_KEY;

    if (!neynarApiKey || neynarApiKey === 'your_neynar_api_key_here') {
      console.warn('Neynar API key not configured');
      return NextResponse.json(
        {
          totalBalance: '0',
          totalBalanceFormatted: '0.00',
          lockedBalance: '0',
          lockedBalanceFormatted: '0.00',
          usdValue: '$0.00',
          pricePerToken: 0,
          higherLogoUrl: '/higher-logo.png',
          addresses: [],
          error: 'Neynar API key not configured',
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Lazy import Neynar SDK
    const { NeynarAPIClient } = await import('@neynar/nodejs-sdk');
    const neynarClient = new NeynarAPIClient({ apiKey: neynarApiKey });

    const userResponse = await neynarClient.fetchBulkUsers({ fids: [fid] });
    const user = userResponse.users[0];

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Get all verified Ethereum addresses
    const verifiedAddresses = user.verified_addresses?.eth_addresses || [];
    
    console.log(`[Balance API] User ${fid} has ${verifiedAddresses.length} verified addresses:`, verifiedAddresses);
    
    if (verifiedAddresses.length === 0) {
      return NextResponse.json(
        {
          totalBalance: '0',
          totalBalanceFormatted: '0.00',
          lockedBalance: '0',
          lockedBalanceFormatted: '0.00',
          usdValue: '$0.00',
          pricePerToken: 0,
          higherLogoUrl: '/higher-logo.png',
          addresses: [],
          message: 'No verified addresses found',
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Create CDP RPC client (optimized for concurrent requests)
    const client = createCDPClient();

    // Get current block number and timestamp once - use this same block for all contract calls to ensure consistency
    const currentBlock = await client.getBlockNumber();
    const block = await client.getBlock({ 
      blockNumber: currentBlock,
      includeTransactions: false 
    });
    const currentTime = Number(block.timestamp);
    const blockAge = Math.floor(Date.now() / 1000) - currentTime;
    const blockInfo = {
      number: currentBlock.toString(),
      timestamp: currentTime,
      iso: new Date(currentTime * 1000).toISOString(),
      ageSeconds: blockAge,
    };
    
    console.log(`[Balance API] Using block ${currentBlock.toString()} at timestamp ${currentTime} (${new Date(currentTime * 1000).toISOString()}), age: ${blockAge}s for all contract calls`);

    // OPTIMIZATION: Fetch lockUpCount once (not per address)
    const lockUpCount = await client.readContract({
      address: LOCKUP_CONTRACT,
      abi: LOCKUP_ABI,
      functionName: 'lockUpCount',
      blockNumber: currentBlock,
    });
    
    console.log(`[Balance API] Total lockup count: ${lockUpCount.toString()}`);

    // OPTIMIZATION: Use multicall to fetch all wallet balances concurrently
    const balanceCalls = verifiedAddresses.map((address) => ({
      address: HIGHER_TOKEN_ADDRESS as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf' as const,
      args: [address as `0x${string}`] as const,
    }));

    const balanceResults = await client.multicall({
      contracts: balanceCalls,
      blockNumber: currentBlock,
    });

    const addressBalances = verifiedAddresses.map((address, index) => {
      const result = balanceResults[index];
      if (result.status === 'success' && result.result) {
        const balance = result.result as bigint;
        const balanceFormatted = formatUnits(balance, 18);
        return {
          address,
          balance: balance.toString(),
          balanceFormatted: parseFloat(balanceFormatted).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
        };
      } else {
        console.error(`Error fetching balance for ${address}:`, result.error);
        return {
          address,
          balance: '0',
          balanceFormatted: '0.00',
        };
      }
    });

    // OPTIMIZATION: Fetch detailed lockups for all addresses concurrently (Alchemy handles this well)
    const allDetailedLockups: DetailedLockupResult[] = await Promise.all(
      verifiedAddresses.map(async (address) => {
        try {
          console.log(`[Balance API] Fetching lockups for address: ${address}`);
          
          const normalizedAddress = getAddress(address); // For debug output

          if (lockUpCount === BigInt(0)) {
            console.log(`[Balance API] No lockups in contract`);
            return { 
              address, 
              lockups: [], 
              unlockedBalance: BigInt(0), 
              lockedBalance: BigInt(0), 
              debug: { 
                lockUpIdsFound: 0, 
                message: 'No lockups in contract', 
                normalizedAddress, 
                originalAddress: address 
              } 
            };
          }

          // Match debug endpoint exactly: use normalized (checksum) address first
          // The debug endpoint works when you manually enter checksum addresses, so prioritize that format
          console.log(`[Balance API] Querying getLockUpIdsByReceiver with: address=${address}, normalized=${normalizedAddress}, start=0, stop=${lockUpCount.toString()}`);

          let lockUpIds: bigint[] = [];
          let workingAddressFormat: string = normalizedAddress; // Default to normalized (checksum) like debug endpoint

          // Try normalized (checksum) address first (matches what debug endpoint likely uses)
          lockUpIds = await client.readContract({
            address: LOCKUP_CONTRACT,
            abi: LOCKUP_ABI,
            functionName: 'getLockUpIdsByReceiver',
            args: [normalizedAddress, BigInt(0), lockUpCount],
            blockNumber: currentBlock, // Use consistent block number
          }) as bigint[];

          console.log(`[Balance API] getLockUpIdsByReceiver returned ${lockUpIds.length} IDs for normalized address ${normalizedAddress}`);

          // If no IDs found with normalized, try original address from Neynar
          if (lockUpIds.length === 0) {
            console.log(`[Balance API] Trying with original Neynar address format: ${address}`);
            lockUpIds = await client.readContract({
              address: LOCKUP_CONTRACT,
              abi: LOCKUP_ABI,
              functionName: 'getLockUpIdsByReceiver',
              args: [address as `0x${string}`, BigInt(0), lockUpCount],
              blockNumber: currentBlock,
            }) as bigint[];
            if (lockUpIds.length > 0) {
              workingAddressFormat = address;
              console.log(`[Balance API] ✓ Found ${lockUpIds.length} IDs with original address`);
            } else {
              console.log(`[Balance API] No IDs found with original address`);
            }
          }

          // If still no IDs, try lowercase
          if (lockUpIds.length === 0) {
            const lowercaseAddress = address.toLowerCase() as `0x${string}`;
            console.log(`[Balance API] Trying with lowercase address: ${lowercaseAddress}`);
            lockUpIds = await client.readContract({
              address: LOCKUP_CONTRACT,
              abi: LOCKUP_ABI,
              functionName: 'getLockUpIdsByReceiver',
              args: [lowercaseAddress, BigInt(0), lockUpCount],
              blockNumber: currentBlock,
            }) as bigint[];
            if (lockUpIds.length > 0) {
              workingAddressFormat = lowercaseAddress;
              console.log(`[Balance API] ✓ Found ${lockUpIds.length} IDs with lowercase address`);
            } else {
              console.log(`[Balance API] No IDs found with lowercase address`);
            }
          }

          if (lockUpIds.length === 0) {
            const debugMsg = `⚠️  No lockup IDs returned for any address format (original: ${address}, normalized: ${normalizedAddress}, lowercase: ${address.toLowerCase()})`;
            console.log(`[Balance API] ${debugMsg}`);
            return { 
              address, 
              lockups: [], 
              unlockedBalance: BigInt(0), 
              lockedBalance: BigInt(0), 
              debug: { 
                lockUpIdsFound: 0, 
                message: debugMsg, 
                normalizedAddress, 
                originalAddress: address 
              } 
            };
          }

          console.log(`[Balance API] ✓ Found ${lockUpIds.length} lockup IDs using address format: ${workingAddressFormat}`);

          const lockUpDetailCalls = lockUpIds.map((id) => ({
            address: LOCKUP_CONTRACT as `0x${string}`,
            abi: LOCKUP_ABI,
            functionName: 'lockUps' as const,
            args: [id] as const,
          }));

          // Process in batches of 50 (Alchemy best practice)
          const BATCH_SIZE = 50;
          const lockUpResults: Array<{ id: bigint; lockUp: readonly [`0x${string}`, boolean, number, boolean, bigint, `0x${string}`, string] } | null> = [];
          
          for (let i = 0; i < lockUpDetailCalls.length; i += BATCH_SIZE) {
            const batch = lockUpDetailCalls.slice(i, i + BATCH_SIZE);
            const batchResults = await client.multicall({
              contracts: batch,
              blockNumber: currentBlock,
            });

            batchResults.forEach((result: { status: 'success' | 'failure'; result?: any; error?: Error }, batchIndex: number) => {
              const id = lockUpIds[i + batchIndex];
              if (result.status === 'success') {
                lockUpResults.push({ 
                  id, 
                  lockUp: result.result as unknown as readonly [`0x${string}`, boolean, number, boolean, bigint, `0x${string}`, string]
                });
              } else {
                console.error(`Error fetching lockup ${id}:`, result.error);
                lockUpResults.push(null);
              }
            });
          }
          const lockups: Array<{
            lockupId: string;
            amount: string;
            amountFormatted: string;
            unlockTime: number;
            receiver: string;
            title: string;
          }> = [];
          
          let unlockedBalance = BigInt(0);
          let lockedBalance = BigInt(0);

          for (const result of lockUpResults) {
            if (!result) continue;
            const { id, lockUp } = result;
            const [token, isERC20, unlockTime, unlocked, amount, receiver, title] = lockUp;
            const tokenAddress = (token as string).toLowerCase();
            const receiverAddr = receiver as string;

            // Verify receiver matches the address we're searching for (case-insensitive comparison)
            // Use the working address format that successfully found lockups
            const receiverMatches = receiverAddr.toLowerCase() === workingAddressFormat.toLowerCase() || 
                                   receiverAddr.toLowerCase() === address.toLowerCase();
            console.log(`[Balance API] Lockup ${id.toString()}: receiver=${receiverAddr}, searchingFor=${address} (workingFormat=${workingAddressFormat}), matches=${receiverMatches}, token=${tokenAddress}, isERC20=${isERC20}, unlocked=${unlocked as boolean}, unlockTime=${Number(unlockTime)}, amount=${(amount as bigint).toString()}`);

            if (!receiverMatches) {
              console.log(`[Balance API] WARNING: Lockup ${id.toString()} receiver ${receiverAddr} does not match verified address ${address} or working format ${workingAddressFormat}`);
              continue;
            }

            if (tokenAddress === HIGHER_TOKEN_ADDRESS.toLowerCase() && isERC20) {
              const unlockTimeNum = Number(unlockTime);
              const unlockedBool = unlocked as boolean;
              const amountBigInt = amount as bigint;

              // Calculate totals (for balance pill)
              if (currentTime >= unlockTimeNum && !unlockedBool) {
                unlockedBalance += amountBigInt;
                console.log(`[Balance API] Added to unlocked balance: ${amountBigInt.toString()}`);
              } else if (currentTime < unlockTimeNum) {
                lockedBalance += amountBigInt;
                console.log(`[Balance API] Added to locked balance: ${amountBigInt.toString()}`);
              } else if (unlockedBool) {
                console.log(`[Balance API] Lockup ${id.toString()} is unlocked - not counting in balance`);
              }

              // Store details for modal (only if not yet unlocked/claimed)
              if (!unlockedBool) {
                lockups.push({
                  lockupId: id.toString(),
                  amount: amountBigInt.toString(),
                  amountFormatted: parseFloat(formatUnits(amountBigInt, 18)).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }),
                  unlockTime: unlockTimeNum,
                  receiver: receiverAddr,
                  title: title as string,
                });
                console.log(`[Balance API] ✓ Added lockup ${id.toString()} to details array`);
              } else {
                console.log(`[Balance API] ✗ Skipped lockup ${id.toString()} - already unlocked/claimed (unlocked=${unlockedBool})`);
              }
            } else {
              if (tokenAddress !== HIGHER_TOKEN_ADDRESS.toLowerCase()) {
                console.log(`[Balance API] ✗ Skipped lockup ${id.toString()} - not HIGHER token (got ${tokenAddress})`);
              } else if (!isERC20) {
                console.log(`[Balance API] ✗ Skipped lockup ${id.toString()} - not ERC20`);
              }
            }
          }

          lockups.sort((a, b) => a.unlockTime - b.unlockTime);
          console.log(`[Balance API] Final summary for ${address}: ${lockups.length} lockups (from ${lockUpIds.length} IDs), locked=${lockedBalance.toString()}, unlocked=${unlockedBalance.toString()}`);
          return { 
            address, 
            lockups, 
            unlockedBalance, 
            lockedBalance,
            debug: {
              lockUpIdsFound: lockUpIds.length,
              lockupsIncluded: lockups.length,
              normalizedAddress,
              originalAddress: address,
            }
          };
        } catch (error: any) {
          console.error(`[Balance API] Error fetching detailed lockups for ${address}:`, error);
          console.error(`[Balance API] Error details:`, error.message, error.stack);
          const normalizedAddress = getAddress(address);
          return { 
            address, 
            lockups: [], 
            unlockedBalance: BigInt(0), 
            lockedBalance: BigInt(0),
            debug: {
              lockUpIdsFound: 0,
              message: error.message,
              normalizedAddress,
              originalAddress: address,
            }
          };
        }
      })
    );

    const totalLockupsFound = allDetailedLockups.reduce((sum, item) => sum + item.lockups.length, 0);
    const totalIdsFound = allDetailedLockups.reduce((sum, item) => sum + (item.debug?.lockUpIdsFound || 0), 0);
    console.log(`[Balance API] Total: ${totalIdsFound} lockup IDs found, ${totalLockupsFound} lockups included in response`);

    // Extract lockup totals and details
    const lockupData = allDetailedLockups.map(item => ({
      unlockedBalance: item.unlockedBalance,
      lockedBalance: item.lockedBalance,
    }));
    
    const allLockupsFlat = allDetailedLockups.flatMap(item => item.lockups);
    const debugInfo = allDetailedLockups.map(item => item.debug).filter(Boolean);

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


    return NextResponse.json(
      {
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
        block: blockInfo,
        debug: {
          verifiedAddresses,
          totalLockupIdsFound: totalIdsFound,
          totalLockupsIncluded: totalLockupsFound,
          perAddress: debugInfo,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Balance API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}


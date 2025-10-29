import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max for cron job

// Contract addresses
const LOCKUP_CONTRACT = '0xA3dCf3Ca587D9929d540868c924f208726DC9aB6' as const;
const HIGHER_TOKEN = '0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe' as const;

// Lockup contract ABI
const LOCKUP_ABI = [
  {
    name: 'lockUpCount',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    name: 'getLockUpIdsByToken',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'start', type: 'uint256' },
      { name: 'stop', type: 'uint256' },
    ],
    outputs: [{ name: 'ids', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    name: 'lockUps',
    inputs: [{ name: '', type: 'uint256' }],
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

// Keyphrase to filter casts
const KEYPHRASE_REGEX = /started\s+aiming\s+higher\s+and\s+it\s+worked\s+out!\s*(.+)/i;

// Helper to extract description after keyphrase
function extractDescription(castText: string): string | null {
  const match = castText.match(KEYPHRASE_REGEX);
  if (!match || !match[1]) return null;
  
  // Extract text after "!" and truncate to 120 characters
  const description = match[1].trim();
  return description.length > 120 
    ? description.substring(0, 120) + '...' 
    : description;
}

// Get HIGHER token price from CoinGecko
async function getTokenPrice(): Promise<number> {
  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/token_price/base?contract_addresses=${HIGHER_TOKEN}&vs_currencies=usd`
    );
    
    if (!response.ok) return 0;
    
    const data = await response.json();
    return data[HIGHER_TOKEN.toLowerCase()]?.usd || 0;
  } catch (error) {
    console.error('Error fetching token price:', error);
    return 0;
  }
}

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (Vercel automatically adds this header)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    // Only enforce auth if CRON_SECRET is set
    if (cronSecret && authHeader && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized - invalid secret' },
        { status: 401 }
      );
    }
    
    console.log('=== Starting staking leaderboard update ===');
    
    const neynarApiKey = process.env.NEYNAR_API_KEY;
    
    if (!neynarApiKey) {
      return NextResponse.json(
        { error: 'Neynar API key not configured' },
        { status: 500 }
      );
    }
    
    // Initialize clients
    const neynarClient = new NeynarAPIClient({ apiKey: neynarApiKey });
    const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    const baseClient = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    });
    
    // Step 1: Get total lockup count
    console.log('Step 1: Getting total lockup count...');
    const totalLockups = await baseClient.readContract({
      address: LOCKUP_CONTRACT,
      abi: LOCKUP_ABI,
      functionName: 'lockUpCount',
    });
    
    console.log(`Total lockups: ${totalLockups}`);
    
    if (totalLockups === 0n) {
      console.log('No lockups found');
      return NextResponse.json({
        success: true,
        message: 'No lockups found',
        processed: 0,
        stored: 0,
      });
    }
    
    // Step 2: Get all HIGHER lockup IDs
    console.log('Step 2: Getting HIGHER lockup IDs...');
    const higherLockupIds = await baseClient.readContract({
      address: LOCKUP_CONTRACT,
      abi: LOCKUP_ABI,
      functionName: 'getLockUpIdsByToken',
      args: [HIGHER_TOKEN, 1n, totalLockups],
    }) as bigint[];
    
    console.log(`Found ${higherLockupIds.length} HIGHER lockups`);
    
    if (higherLockupIds.length === 0) {
      console.log('No HIGHER lockups found');
      return NextResponse.json({
        success: true,
        message: 'No HIGHER lockups found',
        processed: 0,
        stored: 0,
      });
    }
    
    // Step 3: Get lockup details and filter active ones
    console.log('Step 3: Fetching lockup details...');
    const receiverBalances = new Map<string, bigint>();
    
    for (const lockupId of higherLockupIds) {
      try {
        const lockup = await baseClient.readContract({
          address: LOCKUP_CONTRACT,
          abi: LOCKUP_ABI,
          functionName: 'lockUps',
          args: [lockupId],
        }) as readonly [string, boolean, number, boolean, bigint, string, string];
        
        // Destructure for clarity: [token, isERC20, unlockTime, unlocked, amount, receiver, title]
        const [token, isERC20, unlockTime, unlocked, amount, receiver, title] = lockup;
        
        // Only include active (not unlocked) lockups
        if (!unlocked) {
          const receiverLower = receiver.toLowerCase();
          const current = receiverBalances.get(receiverLower) || 0n;
          receiverBalances.set(receiverLower, current + amount);
        }
      } catch (error) {
        console.error(`Error fetching lockup ${lockupId}:`, error);
        // Continue with other lockups
      }
    }
    
    console.log(`Found ${receiverBalances.size} unique active stakers`);
    
    // Step 4: Map addresses to Farcaster accounts
    console.log('Step 4: Mapping addresses to Farcaster accounts...');
    const addressToFid = new Map<string, any>();
    
    // Batch addresses for Neynar lookup (max 350 per request)
    const addresses = Array.from(receiverBalances.keys());
    const batchSize = 350;
    
    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      
      try {
        const users = await neynarClient.fetchBulkUsersByEthOrSolAddress({
          addresses: batch as `0x${string}`[],
        });
        
        // Map addresses to user data
        for (const [address, userArray] of Object.entries(users)) {
          if (userArray && userArray.length > 0) {
            const user = userArray[0]; // Take first user if multiple
            addressToFid.set(address.toLowerCase(), user);
          }
        }
      } catch (error) {
        console.error(`Error fetching users for batch ${i / batchSize}:`, error);
        // Continue with other batches
      }
    }
    
    console.log(`Mapped ${addressToFid.size} addresses to Farcaster accounts`);
    
    // Step 4b: Aggregate balances by FID
    console.log('Step 4b: Aggregating balances by FID...');
    const fidBalances = new Map<number, {
      totalBalance: bigint;
      user: any;
      addresses: string[];
    }>();
    
    for (const [address, balance] of receiverBalances.entries()) {
      const user = addressToFid.get(address);
      
      if (!user) {
        console.log(`No Farcaster account for address ${address}`);
        continue;
      }
      
      const existing = fidBalances.get(user.fid);
      if (existing) {
        // Add to existing balance for this FID
        existing.totalBalance += balance;
        existing.addresses.push(address);
      } else {
        // Create new entry for this FID
        fidBalances.set(user.fid, {
          totalBalance: balance,
          user,
          addresses: [address],
        });
      }
    }
    
    console.log(`Aggregated to ${fidBalances.size} unique FIDs`);
    
    // Step 5: Find casts with keyphrase
    console.log('Step 5: Finding casts with keyphrase...');
    const validEntries = [];
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    for (const [fid, { totalBalance, user, addresses }] of fidBalances.entries()) {
      try {
        console.log(`Checking FID ${fid} (${user.username}) with total balance ${formatUnits(totalBalance, 18)} HIGHER from ${addresses.length} address(es)`);
        
        // Fetch recent casts from user
        const userCasts = await neynarClient.fetchCastsForUser({
          fid: user.fid,
          limit: 25,
        });
        
        // Filter for /higher channel casts with keyphrase
        const higherCasts = (userCasts.casts || []).filter((cast: any) => {
          const castTime = new Date(cast.timestamp);
          const isRecent = castTime > oneDayAgo;
          const isHigherChannel = cast.channel?.id === 'higher' || cast.parent_url?.includes('/higher');
          const hasKeyphrase = extractDescription(cast.text);
          
          return isRecent && isHigherChannel && hasKeyphrase;
        });
        
        if (higherCasts.length > 0) {
          // Take most recent matching cast
          const latestCast = higherCasts[0];
          const description = extractDescription(latestCast.text);
          
          if (description) {
            console.log(`  ✓ Found matching cast for ${user.username}`);
            validEntries.push({
              fid: user.fid,
              username: user.username,
              displayName: user.display_name || user.username,
              pfpUrl: user.pfp_url || '',
              castHash: latestCast.hash,
              castText: latestCast.text,
              description,
              timestamp: latestCast.timestamp,
              stakedBalance: totalBalance, // Total across all addresses
            });
          }
        } else {
          console.log(`  ✗ No matching cast for ${user.username}`);
        }
      } catch (error) {
        console.error(`Error fetching casts for FID ${fid}:`, error);
        // Continue with other users
      }
    }
    
    console.log(`Found ${validEntries.length} entries with matching casts`);
    
    // Step 6: Calculate USD values and sort
    const tokenPrice = await getTokenPrice();
    console.log(`HIGHER token price: $${tokenPrice}`);
    
    const entriesWithUsd = validEntries.map(entry => {
      const balanceFormatted = parseFloat(formatUnits(entry.stakedBalance, 18));
      const usdValue = balanceFormatted * tokenPrice;
      
      return {
        ...entry,
        balanceFormatted,
        usdValue,
      };
    });
    
    // Sort by staked balance and keep top 100
    entriesWithUsd.sort((a, b) => b.balanceFormatted - a.balanceFormatted);
    const top100 = entriesWithUsd.slice(0, 100);
    
    console.log(`Sorted by balance, storing top ${top100.length} entries`);
    
    console.log(`Storing top ${top100.length} entries in database...`);
    
    // Validate: Check for duplicate FIDs in top100
    const fidSet = new Set();
    const duplicates = [];
    for (const entry of top100) {
      if (fidSet.has(entry.fid)) {
        duplicates.push(entry.fid);
      }
      fidSet.add(entry.fid);
    }
    
    if (duplicates.length > 0) {
      console.error(`ERROR: Found duplicate FIDs in top100:`, duplicates);
      throw new Error(`Duplicate FIDs found: ${duplicates.join(', ')}`);
    }
    
    console.log('Validation passed: All FIDs are unique');
    
    // Step 7: Update database using UPSERT (INSERT ... ON CONFLICT)
    console.log('Clearing old entries and inserting new ones...');
    
    // First, delete all entries
    const deleteResult = await sql`DELETE FROM leaderboard_entries`;
    console.log(`Deleted ${deleteResult.rowCount} old entries`);
    
    console.log('Inserting new entries...');
    for (let i = 0; i < top100.length; i++) {
      const entry = top100[i];
      console.log(`Inserting entry ${i + 1}: FID ${entry.fid}, balance ${entry.balanceFormatted}`);
      
      try {
        const insertResult = await sql`
          INSERT INTO leaderboard_entries (
            fid, username, display_name, pfp_url, cast_hash, cast_text,
            description, cast_timestamp, higher_balance, usd_value, rank
          ) VALUES (
            ${entry.fid},
            ${entry.username},
            ${entry.displayName},
            ${entry.pfpUrl},
            ${entry.castHash},
            ${entry.castText},
            ${entry.description},
            ${entry.timestamp},
            ${entry.balanceFormatted},
            ${entry.usdValue},
            ${i + 1}
          )
          ON CONFLICT (fid) DO UPDATE SET
            username = EXCLUDED.username,
            display_name = EXCLUDED.display_name,
            pfp_url = EXCLUDED.pfp_url,
            cast_hash = EXCLUDED.cast_hash,
            cast_text = EXCLUDED.cast_text,
            description = EXCLUDED.description,
            cast_timestamp = EXCLUDED.cast_timestamp,
            higher_balance = EXCLUDED.higher_balance,
            usd_value = EXCLUDED.usd_value,
            rank = EXCLUDED.rank,
            updated_at = NOW()
        `;
        console.log(`Inserted/Updated entry ${i + 1}, rowCount: ${insertResult.rowCount}`);
      } catch (insertError: any) {
        console.error(`Error inserting FID ${entry.fid}:`, insertError.message);
        throw insertError;
      }
    }
    
    // Verify the inserts
    console.log('Verifying database writes...');
    const verifyResult = await sql`SELECT COUNT(*) as count FROM leaderboard_entries`;
    const finalCount = parseInt(verifyResult.rows[0]?.count || '0');
    console.log(`Database now contains ${finalCount} entries`);
    
    if (finalCount !== top100.length) {
      console.error(`WARNING: Expected ${top100.length} entries but found ${finalCount}`);
    }
    
    console.log('=== Staking leaderboard updated successfully ===');
    
    return NextResponse.json({
      success: true,
      totalLockups: Number(totalLockups),
      higherLockups: higherLockupIds.length,
      activeStakers: receiverBalances.size,
      mappedToFarcaster: addressToFid.size,
      withMatchingCasts: validEntries.length,
      stored: top100.length,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error: any) {
    console.error('=== STAKING LEADERBOARD UPDATE ERROR ===');
    console.error('Error:', error);
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        message: error.message || String(error),
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}


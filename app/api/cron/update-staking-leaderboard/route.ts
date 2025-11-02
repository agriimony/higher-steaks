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

// Helper to check if a string is a valid cast hash (starts with 0x, is 66 chars)
function isValidCastHash(hash: string): boolean {
  return typeof hash === 'string' && hash.startsWith('0x') && hash.length === 66;
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
    // Use Alchemy if available, otherwise fallback to BASE_RPC_URL or public RPC
    const alchemyApiKey = process.env.ALCHEMY_API_KEY;
    const rpcUrl = alchemyApiKey 
      ? `https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`
      : (process.env.BASE_RPC_URL || 'https://mainnet.base.org');
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
    
    // Step 3: Get lockup details and aggregate by cast_hash
    console.log('Step 3: Fetching lockup details and aggregating by cast hash...');
    const castBalances = new Map<string, {
      totalAmount: bigint;
      receivers: Set<string>; // Track unique receiver addresses per cast
    }>();
    
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
        
        // Only include active (not unlocked) lockups with valid cast hashes
        if (!unlocked && isValidCastHash(title)) {
          const existing = castBalances.get(title);
          if (existing) {
            existing.totalAmount += amount;
            existing.receivers.add(receiver.toLowerCase());
          } else {
            castBalances.set(title, {
              totalAmount: amount,
              receivers: new Set([receiver.toLowerCase()]),
            });
          }
        }
      } catch (error) {
        console.error(`Error fetching lockup ${lockupId}:`, error);
        // Continue with other lockups
      }
    }
    
    console.log(`Found ${castBalances.size} unique cast hashes with active lockups`);
    
    // Step 4: Fetch cast details and validate keyphrase
    console.log('Step 4: Fetching cast details and validating keyphrase...');
    const validEntries = [];
    
    for (const [castHash, { totalAmount, receivers }] of castBalances.entries()) {
      try {
        console.log(`Checking cast ${castHash} with ${formatUnits(totalAmount, 18)} HIGHER staked from ${receivers.size} staker(s)`);
        
        // Fetch cast details from Neynar
        const castResponse = await neynarClient.lookupCastByHashOrUrl({ 
          identifier: castHash,
          type: 'hash'
        });
        const cast = castResponse.result?.cast;
        
        if (!cast) {
          console.log(`  ✗ Cast not found: ${castHash}`);
          continue;
        }
        
        // Validate keyphrase
        const description = extractDescription(cast.text);
        if (!description) {
          console.log(`  ✗ Cast missing keyphrase: ${castHash}`);
          continue;
        }
        
        // Validate /higher channel
        const isHigherChannel = cast.channel?.id === 'higher' || cast.parent_url?.includes('/higher');
        if (!isHigherChannel) {
          console.log(`  ✗ Cast not in /higher channel: ${castHash}`);
          continue;
        }
        
        console.log(`  ✓ Valid cast found for ${castHash}`);
        validEntries.push({
          castHash,
          creatorFid: cast.author.fid,
          creatorUsername: cast.author.username,
          creatorDisplayName: cast.author.display_name || cast.author.username,
          creatorPfpUrl: cast.author.pfp_url || '',
          castText: cast.text,
          description,
          timestamp: cast.timestamp,
          stakedBalance: totalAmount,
          stakerAddresses: Array.from(receivers),
        });
      } catch (error) {
        console.error(`Error fetching cast ${castHash}:`, error);
        // Continue with other casts
      }
    }
    
    console.log(`Found ${validEntries.length} valid casts with keyphrase`);
    
    // Step 4b: Map staker addresses to FIDs
    console.log('Step 4b: Mapping staker addresses to FIDs...');
    const addressToFid = new Map<string, number>();
    const allStakerAddresses = new Set<string>();
    validEntries.forEach(entry => entry.stakerAddresses.forEach(addr => allStakerAddresses.add(addr)));
    
    const batchSize = 350;
    const addresses = Array.from(allStakerAddresses);
    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      try {
        const users = await neynarClient.fetchBulkUsersByEthOrSolAddress({
          addresses: batch as `0x${string}`[],
        });
        for (const [address, userArray] of Object.entries(users)) {
          if (userArray && userArray.length > 0) {
            addressToFid.set(address.toLowerCase(), userArray[0].fid);
          }
        }
      } catch (error) {
        console.error(`Error fetching users for batch ${i / batchSize}:`, error);
      }
    }
    
    // Add staker FIDs to each entry
    validEntries.forEach(entry => {
      entry.stakerFids = entry.stakerAddresses
        .map(addr => addressToFid.get(addr))
        .filter(fid => fid !== undefined) as number[];
    });
    
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
    
    // Sort by staked balance descending and take top 100
    entriesWithUsd.sort((a, b) => b.balanceFormatted - a.balanceFormatted);
    
    const top100 = entriesWithUsd.slice(0, 100);
    
    console.log(`Sorted by balance, storing top ${top100.length} entries`);
    
    console.log(`Storing top ${top100.length} entries in database...`);
    
    // Step 7: Update database using UPSERT (INSERT ... ON CONFLICT)
    console.log('Clearing old entries and inserting new ones...');
    
    // First, delete all entries
    const deleteResult = await sql`DELETE FROM leaderboard_entries`;
    console.log(`Deleted ${deleteResult.rowCount} old entries`);
    
    console.log('Inserting new entries...');
    for (let i = 0; i < top100.length; i++) {
      const entry = top100[i];
      console.log(`Inserting entry ${i + 1}: Cast ${entry.castHash}, Creator FID ${entry.creatorFid}, balance ${entry.balanceFormatted}`);
      
      try {
        const insertResult = await sql`
          INSERT INTO leaderboard_entries (
            cast_hash, creator_fid, creator_username, creator_display_name, creator_pfp_url,
            cast_text, description, cast_timestamp, total_higher_staked, staker_fids,
            usd_value, rank
          ) VALUES (
            ${entry.castHash},
            ${entry.creatorFid},
            ${entry.creatorUsername},
            ${entry.creatorDisplayName},
            ${entry.creatorPfpUrl},
            ${entry.castText},
            ${entry.description},
            ${entry.timestamp},
            ${entry.balanceFormatted},
            ${entry.stakerFids},
            ${entry.usdValue},
            ${i + 1}
          )
          ON CONFLICT (cast_hash) DO UPDATE SET
            creator_fid = EXCLUDED.creator_fid,
            creator_username = EXCLUDED.creator_username,
            creator_display_name = EXCLUDED.creator_display_name,
            creator_pfp_url = EXCLUDED.creator_pfp_url,
            cast_text = EXCLUDED.cast_text,
            description = EXCLUDED.description,
            cast_timestamp = EXCLUDED.cast_timestamp,
            total_higher_staked = EXCLUDED.total_higher_staked,
            staker_fids = EXCLUDED.staker_fids,
            usd_value = EXCLUDED.usd_value,
            rank = EXCLUDED.rank,
            updated_at = NOW()
        `;
        console.log(`Inserted/Updated entry ${i + 1}, rowCount: ${insertResult.rowCount}`);
      } catch (insertError: any) {
        console.error(`Error inserting cast ${entry.castHash}:`, insertError.message);
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
      uniqueCasts: castBalances.size,
      validCasts: validEntries.length,
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


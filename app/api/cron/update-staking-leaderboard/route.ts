import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { extractDescription, isValidCastHash, containsKeyphrase } from '@/lib/cast-helpers';
import { isValidStake, getFidsFromAddresses, type LockupData } from '@/lib/services/stake-service';
import { upsertHigherCast } from '@/lib/services/db-service';

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
    
    // Check RPC block freshness with retry logic
    console.log('Checking RPC block freshness...');
    let latestBlock;
    const MAX_RETRY_DURATION = 180000; // 3 minutes in milliseconds
    const STALE_THRESHOLD = 600; // 10 minutes in seconds
    const retryDelays = [5000, 10000, 20000, 40000, 45000]; // exponential backoff delays in ms
    const startTime = Date.now();
    let attempt = 0;
    let blockIsFresh = false;
    
    while (Date.now() - startTime < MAX_RETRY_DURATION) {
      try {
        latestBlock = await baseClient.getBlock({ blockTag: 'latest' });
        const blockTime = latestBlock.timestamp;
        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        const ageInSeconds = Number(currentTime - blockTime);
        const ageInMinutes = ageInSeconds / 60;
        
        console.log(`Attempt ${attempt + 1}: Block #${latestBlock.number}, age: ${ageInSeconds}s (${ageInMinutes.toFixed(2)} min)`);
        
        if (ageInSeconds <= STALE_THRESHOLD) {
          console.log(`✓ Block is fresh (≤ 10 minutes old)`);
          blockIsFresh = true;
          break;
        } else {
          console.warn(`⚠️  Block is stale (${ageInMinutes.toFixed(2)} min old), retrying...`);
        }
      } catch (error) {
        console.error(`Error fetching block on attempt ${attempt + 1}:`, error);
      }
      
      // Calculate delay for next retry (use exponential backoff, capped at 45s)
      const delayIndex = Math.min(attempt, retryDelays.length - 1);
      const delay = retryDelays[delayIndex];
      const elapsed = Date.now() - startTime;
      const remaining = MAX_RETRY_DURATION - elapsed;
      
      if (remaining > delay) {
        console.log(`Waiting ${delay}ms before next retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        attempt++;
      } else {
        break;
      }
    }
    
    // Check if we got a fresh block
    if (!blockIsFresh || !latestBlock) {
      const finalAge = latestBlock ? Number(BigInt(Math.floor(Date.now() / 1000)) - latestBlock.timestamp) : 'unknown';
      console.error(`✗ Failed to get fresh block after ${attempt + 1} attempts, age: ${finalAge}s`);
      return NextResponse.json(
        { 
          success: false,
          error: 'RPC block is stale after 3 minutes of retries',
          blockAge: finalAge,
          attempts: attempt + 1
        },
        { status: 503 }
      );
    }
    
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
    
    // Step 2: Fetch lockup details and classify as caster or supporter stakes
    console.log('Step 2: Fetching lockup details and classifying stakes...');
    const currentTime = Math.floor(Date.now() / 1000);
    
    // Map to store lockups by cast hash
    const castLockups = new Map<string, Array<{
      lockupId: bigint;
      receiver: string;
      amount: bigint;
      unlockTime: number;
      type: 'caster' | 'supporter' | 'pending';
    }>>();
    
    let lockupsProcessed = 0;
    let lockupsUnlocked = 0;
    let lockupsInvalidHash = 0;
    let lockupsWithValidHash = 0;
    
    for (const lockupId of higherLockupIds) {
      try {
        const lockup = await baseClient.readContract({
          address: LOCKUP_CONTRACT,
          abi: LOCKUP_ABI,
          functionName: 'lockUps',
          args: [lockupId],
        }) as readonly [string, boolean, number, boolean, bigint, string, string];
        
        lockupsProcessed++;
        
        // Destructure: [token, isERC20, unlockTime, unlocked, amount, receiver, title]
        const [token, isERC20, unlockTime, unlocked, amount, receiver, title] = lockup;
        
        // Create lockup data object
        const lockupData: LockupData = {
          lockupId: lockupId.toString(),
          token,
          isERC20,
          unlockTime: Number(unlockTime),
          unlocked: unlocked as boolean,
          amount: amount as bigint,
          receiver,
          title,
        };
        
        // Validate stake
        if (!isValidStake(lockupData, currentTime)) {
          if (unlocked) {
            lockupsUnlocked++;
          } else if (!isValidCastHash(title)) {
            lockupsInvalidHash++;
          }
          continue;
        }
        
        lockupsWithValidHash++;
        const castHash = title;
        
        // Initialize array for this cast if needed
        if (!castLockups.has(castHash)) {
          castLockups.set(castHash, []);
        }
        
        // Classify as pending for now (will be classified after getting creator FIDs)
        castLockups.get(castHash)!.push({
          lockupId,
          receiver: receiver.toLowerCase(),
          amount,
          unlockTime: Number(unlockTime),
          type: 'pending',
        });
      } catch (error) {
        console.error(`Error fetching lockup ${lockupId}:`, error);
        // Continue with other lockups
      }
    }
    
    console.log(`Lockup processing summary:`);
    console.log(`  Total lockups processed: ${lockupsProcessed}`);
    console.log(`  Unlocked (skipped): ${lockupsUnlocked}`);
    console.log(`  Invalid cast hash (skipped): ${lockupsInvalidHash}`);
    console.log(`  Valid lockups (included): ${lockupsWithValidHash}`);
    console.log(`Found ${castLockups.size} unique cast hashes with active lockups`);
    
    // Step 3: Validate casts and get creator FIDs
    console.log('Step 3: Validating casts and fetching creator info...');
    const castInfo = new Map<string, {
      creatorFid: number;
      creatorUsername: string;
      creatorDisplayName: string;
      creatorPfpUrl: string;
      castText: string;
      description: string;
      timestamp: string;
      isValid: boolean;
    }>();
    
    for (const castHash of castLockups.keys()) {
      try {
        console.log(`  Validating cast ${castHash}...`);
        const castResponse = await neynarClient.lookupCastByHashOrUrl({
          identifier: castHash,
          type: 'hash'
        });
        
        const cast = castResponse.cast;
        if (!cast) {
          console.log(`  ✗ Cast not found: ${castHash}`);
          continue;
        }
        
        // Validate keyphrase
        if (!containsKeyphrase(cast.text)) {
          console.log(`  ✗ Cast missing keyphrase: ${castHash}`);
          continue;
        }
        
        // Validate /higher channel
        const isHigherChannel = cast.channel?.id === 'higher' || cast.parent_url?.includes('/higher');
        if (!isHigherChannel) {
          console.log(`  ✗ Cast not in /higher channel: ${castHash}`);
          continue;
        }
        
        const description = extractDescription(cast.text) || '';
        
        castInfo.set(castHash, {
          creatorFid: cast.author.fid,
          creatorUsername: cast.author.username,
          creatorDisplayName: cast.author.display_name || cast.author.username,
          creatorPfpUrl: cast.author.pfp_url || '',
          castText: cast.text,
          description,
          timestamp: cast.timestamp,
          isValid: true,
        });
        
        console.log(`  ✓ Valid cast: ${castHash}, creator FID: ${cast.author.fid}`);
      } catch (error: any) {
        console.error(`Error validating cast ${castHash}:`, error);
        // Continue with other casts
      }
    }
    
    console.log(`Validated ${castInfo.size} casts`);
    
    // Step 4: Classify stakes and build higher casts list
    console.log('Step 4: Classifying stakes and building higher casts list...');
    
    // Collect all receiver addresses for batch FID lookup
    const allReceiverAddresses = new Set<string>();
    for (const lockups of castLockups.values()) {
      for (const lockup of lockups) {
        allReceiverAddresses.add(lockup.receiver);
      }
    }
    
    // Batch get FIDs for all receiver addresses
    console.log(`  Mapping ${allReceiverAddresses.size} addresses to FIDs...`);
    const addressToFid = await getFidsFromAddresses(Array.from(allReceiverAddresses));
    console.log(`  Mapped ${addressToFid.size} addresses to FIDs`);
    
    // Classify stakes and build entries
    const validEntries: Array<{
      castHash: string;
      creatorFid: number;
      creatorUsername: string;
      creatorDisplayName: string;
      creatorPfpUrl: string;
      castText: string;
      description: string;
      timestamp: string;
      casterStakeLockupIds: number[];
      casterStakeAmounts: string[];
      casterStakeUnlockTimes: number[];
      supporterStakeLockupIds: number[];
      supporterStakeAmounts: string[];
      supporterStakeFids: number[];
      stakerFids: number[]; // For backward compatibility: [creator_fid, ...supporter_stake_fids]
      totalStaked: bigint;
    }> = [];
    
    for (const [castHash, info] of castInfo.entries()) {
      if (!info.isValid) continue;
      
      const lockups = castLockups.get(castHash) || [];
      const creatorFid = info.creatorFid;
      
      // Classify stakes
      const casterStakes: Array<{ lockupId: bigint; amount: bigint; unlockTime: number }> = [];
      const supporterStakes: Array<{ lockupId: bigint; amount: bigint; unlockTime: number; fid: number }> = [];
      
      for (const lockup of lockups) {
        const receiverFid = addressToFid.get(lockup.receiver);
        if (receiverFid === creatorFid) {
          // Caster stake
          casterStakes.push({
            lockupId: lockup.lockupId,
            amount: lockup.amount,
            unlockTime: lockup.unlockTime,
          });
        } else if (receiverFid) {
          // Supporter stake
          supporterStakes.push({
            lockupId: lockup.lockupId,
            amount: lockup.amount,
            unlockTime: lockup.unlockTime,
            fid: receiverFid,
          });
        }
      }
      
      // Only include casts with at least one valid caster stake
      if (casterStakes.length === 0) {
        console.log(`  ✗ Cast ${castHash} has no valid caster stake, skipping`);
        continue;
      }
      
      // Filter supporter stakes: only include if unlockTime > max caster stake unlockTime
      const maxCasterUnlockTime = Math.max(...casterStakes.map(s => s.unlockTime));
      const validSupporterStakes = supporterStakes.filter(s => s.unlockTime > maxCasterUnlockTime);
      
      // Calculate total staked (caster + supporter)
      const totalCasterStaked = casterStakes.reduce((sum, s) => sum + s.amount, BigInt(0));
      const totalSupporterStaked = validSupporterStakes.reduce((sum, s) => sum + s.amount, BigInt(0));
      const totalStaked = totalCasterStaked + totalSupporterStaked;
      
      // Build staker_fids array: [creator_fid, ...unique supporter_fids]
      // (for backward compatibility - can be derived from creator_fid + supporter_stake_fids)
      const stakerFids = new Set<number>([creatorFid]);
      validSupporterStakes.forEach(s => stakerFids.add(s.fid));
      
      validEntries.push({
        castHash,
        creatorFid: info.creatorFid,
        creatorUsername: info.creatorUsername,
        creatorDisplayName: info.creatorDisplayName,
        creatorPfpUrl: info.creatorPfpUrl,
        castText: info.castText,
        description: info.description,
        timestamp: info.timestamp,
        casterStakeLockupIds: casterStakes.map(s => Number(s.lockupId)),
        casterStakeAmounts: casterStakes.map(s => s.amount.toString()),
        casterStakeUnlockTimes: casterStakes.map(s => s.unlockTime),
        supporterStakeLockupIds: validSupporterStakes.map(s => Number(s.lockupId)),
        supporterStakeAmounts: validSupporterStakes.map(s => s.amount.toString()),
        supporterStakeFids: validSupporterStakes.map(s => s.fid),
        stakerFids: Array.from(stakerFids), // For backward compatibility
        totalStaked,
      });
    }
    
    console.log(`Built ${validEntries.length} higher casts with valid caster stakes`);
    
    // Step 5: Calculate USD values and sort
    const tokenPrice = await getTokenPrice();
    console.log(`HIGHER token price: $${tokenPrice}`);
    
    const entriesWithUsd = validEntries.map(entry => {
      const balanceFormatted = parseFloat(formatUnits(entry.totalStaked, 18));
      const usdValue = balanceFormatted * tokenPrice;
      
      return {
        ...entry,
        balanceFormatted,
        usdValue,
      };
    });
    
    // Sort by total staked balance descending and take top 100
    entriesWithUsd.sort((a, b) => b.balanceFormatted - a.balanceFormatted);
    
    const top100 = entriesWithUsd.slice(0, 100);
    
    console.log(`Sorted by balance, storing top ${top100.length} entries`);
    
    // Step 6: Update database using new schema
    console.log('Step 6: Updating database with new schema...');
    
    // First, delete all entries (we'll only keep casts with valid caster stakes)
    const deleteResult = await sql`DELETE FROM leaderboard_entries`;
    console.log(`Deleted ${deleteResult.rowCount} old entries`);
    
    console.log('Inserting new entries with caster/supporter stake separation...');
    for (let i = 0; i < top100.length; i++) {
      const entry = top100[i];
      console.log(`Inserting entry ${i + 1}: Cast ${entry.castHash}, Creator FID ${entry.creatorFid}, balance ${entry.balanceFormatted}`);
      
      try {
        await upsertHigherCast({
          castHash: entry.castHash,
          creatorFid: entry.creatorFid,
          creatorUsername: entry.creatorUsername,
          creatorDisplayName: entry.creatorDisplayName,
          creatorPfpUrl: entry.creatorPfpUrl,
          castText: entry.castText,
          description: entry.description,
          castTimestamp: entry.timestamp,
          totalHigherStaked: entry.balanceFormatted, // Sum of caster_stake_amounts + supporter_stake_amounts
          usdValue: entry.usdValue,
          rank: i + 1,
          casterStakeLockupIds: entry.casterStakeLockupIds,
          casterStakeAmounts: entry.casterStakeAmounts,
          casterStakeUnlockTimes: entry.casterStakeUnlockTimes,
          supporterStakeLockupIds: entry.supporterStakeLockupIds,
          supporterStakeAmounts: entry.supporterStakeAmounts,
          supporterStakeFids: entry.supporterStakeFids,
          stakerFids: entry.stakerFids, // For backward compatibility
          castState: 'higher',
        });
        console.log(`Inserted/Updated entry ${i + 1}`);
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


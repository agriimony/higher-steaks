import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max for cron job

// HIGHER token contract
const HIGHER_TOKEN_ADDRESS = '0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe';

const ERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
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
      `https://api.coingecko.com/api/v3/simple/token_price/base?contract_addresses=${HIGHER_TOKEN_ADDRESS}&vs_currencies=usd`
    );
    
    if (!response.ok) return 0;
    
    const data = await response.json();
    return data[HIGHER_TOKEN_ADDRESS.toLowerCase()]?.usd || 0;
  } catch (error) {
    console.error('Error fetching token price:', error);
    return 0;
  }
}

// Get HIGHER balance for a user's verified addresses
async function getUserBalance(
  neynarClient: NeynarAPIClient,
  baseClient: any, // Type assertion to avoid viem version mismatch
  fid: number
): Promise<bigint> {
  try {
    const userResponse = await neynarClient.fetchBulkUsers({ fids: [fid] });
    const user = userResponse.users[0];
    
    if (!user) return BigInt(0);
    
    const verifiedAddresses = user.verified_addresses?.eth_addresses || [];
    
    if (verifiedAddresses.length === 0) return BigInt(0);
    
    // Fetch balances for all verified addresses
    const balances = await Promise.all(
      verifiedAddresses.map(async (address) => {
        try {
          const balance = await baseClient.readContract({
            address: HIGHER_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [address as `0x${string}`],
          });
          return balance;
        } catch (error) {
          console.error(`Error fetching balance for ${address}:`, error);
          return BigInt(0);
        }
      })
    );
    
    // Sum all balances
    return balances.reduce((sum, balance) => sum + balance, BigInt(0));
  } catch (error) {
    console.error(`Error fetching balance for FID ${fid}:`, error);
    return BigInt(0);
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
    
    // Log for debugging
    console.log('Cron job triggered:', {
      hasSecret: !!cronSecret,
      hasAuth: !!authHeader,
      timestamp: new Date().toISOString(),
    });
    
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
    
    console.log('Fetching recent casts (FREE TIER workaround)...');
    
    // FREE TIER WORKAROUND:
    // Since channel feeds and searchCasts require paid plans, we'll use a hybrid approach:
    // 1. Manually maintain a list of active HIGHER community FIDs
    // 2. Fetch their recent casts using fetchBulkCastsByUser (free tier)
    // 3. Filter for /higher channel and keyphrase client-side
    
    // Seed list of known HIGHER community members (expand this list over time)
    // You can find active members by visiting warpcast.com/~/channel/higher
    const knownHigherFids = [
      191780, // YOU - for testing
      3,      // dwr
      2,      // v
      239,    // composta  
      602,    // wake
      1231,   // jayme
      15971,  // ted
      // Add more active /higher community member FIDs here
      // This list can be expanded based on who posts frequently
    ];
    
    console.log(`Fetching casts from ${knownHigherFids.length} known HIGHER community members...`);
    
    // Calculate time range (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const allCasts: any[] = [];
    
    // Fetch recent casts for each known FID
    for (const fid of knownHigherFids) {
      try {
        const userCasts = await neynarClient.fetchCastsForUser({
          fid,
          limit: 25, // Check last 25 casts per user
        });
        
        // Filter for /higher channel and within last 24h
        const higherCasts = (userCasts.casts || []).filter((cast: any) => {
          const castTime = new Date(cast.timestamp);
          const isRecent = castTime > oneDayAgo;
          const isHigherChannel = cast.channel?.id === 'higher' || cast.parent_url?.includes('/higher');
          return isRecent && isHigherChannel;
        });
        
        allCasts.push(...higherCasts);
      } catch (error) {
        console.error(`Error fetching casts for FID ${fid}:`, error);
        // Continue with other FIDs
      }
    }
    
    const casts = allCasts;
    console.log(`Found ${casts.length} total casts from /higher channel in last 24h`);
    
    console.log(`Found ${casts.length} casts matching keyphrase`);
    
    // Filter and process casts
    const validCasts = new Map(); // FID -> cast data (keep only most recent per FID)
    
    for (const cast of casts) {
      const description = extractDescription(cast.text);
      
      if (!description) continue; // Skip if keyphrase not found or no description
      
      const fid = cast.author.fid;
      const castTimestamp = new Date(cast.timestamp);
      
      // Keep only the most recent cast per FID
      const existing = validCasts.get(fid);
      if (!existing || castTimestamp > new Date(existing.timestamp)) {
        validCasts.set(fid, {
          fid,
          username: cast.author.username,
          displayName: cast.author.display_name || cast.author.username,
          pfpUrl: cast.author.pfp_url || '',
          castHash: cast.hash,
          castText: cast.text,
          description,
          timestamp: cast.timestamp,
        });
      }
    }
    
    console.log(`Processing ${validCasts.size} unique users...`);
    
    // Get balances for all users
    const tokenPrice = await getTokenPrice();
    const entries = [];
    
    for (const [fid, castData] of Array.from(validCasts.entries())) {
      const balance = await getUserBalance(neynarClient, baseClient, fid);
      const balanceFormatted = parseFloat(formatUnits(balance, 18));
      const usdValue = balanceFormatted * tokenPrice;
      
      entries.push({
        ...castData,
        higherBalance: balance.toString(),
        balanceFormatted,
        usdValue,
      });
    }
    
    // Sort by balance and keep top 100
    entries.sort((a, b) => b.balanceFormatted - a.balanceFormatted);
    const top100 = entries.slice(0, 100);
    
    console.log(`Upserting ${top100.length} entries to database...`);
    
    // Clear existing data and insert new entries
    await sql`DELETE FROM leaderboard_entries`;
    
    // Insert entries with rank
    for (let i = 0; i < top100.length; i++) {
      const entry = top100[i];
      await sql`
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
          ${entry.higherBalance},
          ${entry.usdValue},
          ${i + 1}
        )
      `;
    }
    
    console.log('Leaderboard updated successfully');
    
    return NextResponse.json({
      success: true,
      processed: validCasts.size,
      stored: top100.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Cron job error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        message: errorMessage,
        stack: process.env.NODE_ENV === 'development' ? errorStack : undefined,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}


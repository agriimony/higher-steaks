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
    
    // Fetch casts from /higher channel (last 24 hours)
    // Note: Neynar's feed API may have different methods - adjust as needed
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    console.log('Fetching casts from /higher channel...');
    
    // Try using lookupChannel and then fetchAllCastsInThread or fetchFeed
    // Free tier workaround: fetch recent feed and filter by channel
    let casts: any[] = [];
    
    try {
      // Option 1: Try fetchFeed with filter_type
      const castsResponse = await neynarClient.fetchFeed({
        filterType: 'channel_id' as any,
        channelId: 'higher',
        limit: 100,
        withRecasts: false,
      });
      casts = castsResponse.casts || [];
    } catch (error1) {
      console.log('fetchFeed failed, trying alternative...', error1);
      
      // Option 2: If that fails, return error with helpful message
      throw new Error(
        'Unable to fetch channel feed. This may require a paid Neynar plan. ' +
        'Free tier only includes: user lookups, cast by hash, and user feeds. ' +
        'Consider upgrading to Neynar Growth plan ($49/mo) for channel feeds.'
      );
    }
    
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


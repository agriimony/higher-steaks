import { NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

// Force Node.js runtime
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Creates an RPC client for Base network
 */
function createBaseClient() {
  const alchemyApiKey = process.env.ALCHEMY_API_KEY;
  
  if (!alchemyApiKey) {
    const fallbackUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    return createPublicClient({
      chain: base,
      transport: http(fallbackUrl),
    });
  }

  const alchemyUrl = `https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`;
  
  return createPublicClient({
    chain: base,
    transport: http(alchemyUrl),
  });
}

export async function GET() {
  try {
    const client = createBaseClient();
    
    // Get latest block number and timestamp
    const blockNumber = await client.getBlockNumber();
    const block = await client.getBlock({ 
      blockNumber,
      includeTransactions: false 
    });
    
    const blockTimestamp = Number(block.timestamp);
    const currentTime = Math.floor(Date.now() / 1000);
    const ageSeconds = currentTime - blockTimestamp;
    
    // Determine status
    let status: 'fresh' | 'stale' | 'very_stale';
    if (ageSeconds < 5 * 60) {
      status = 'fresh'; // < 5 minutes
    } else if (ageSeconds < 30 * 60) {
      status = 'stale'; // 5-30 minutes
    } else {
      status = 'very_stale'; // > 30 minutes
    }
    
    return NextResponse.json({
      blockNumber: blockNumber.toString(),
      timestamp: blockTimestamp,
      ageSeconds,
      status,
    });
  } catch (error) {
    console.error('[Block Liveness API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch block liveness' },
      { status: 500 }
    );
  }
}

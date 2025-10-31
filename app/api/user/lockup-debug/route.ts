import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';

// Force Node.js runtime
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// HIGHER token contract address on Base
const HIGHER_TOKEN_ADDRESS = '0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe';

// Lockup contract address on Base
const LOCKUP_CONTRACT = '0xA3dCf3Ca587D9929d540868c924f208726DC9aB6';

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
    const action = searchParams.get('action'); // 'by-receiver', 'by-id', 'all-higher', 'count'
    const receiver = searchParams.get('receiver');
    const lockupId = searchParams.get('id');

    // Create Base RPC client
    const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    const client = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    });

    // Get current block timestamp
    const currentBlock = await client.getBlockNumber();
    const block = await client.getBlock({ 
      blockNumber: currentBlock,
      includeTransactions: false 
    });
    const currentTime = Number(block.timestamp);

    // Get total lockup count
    const lockUpCount = await client.readContract({
      address: LOCKUP_CONTRACT,
      abi: LOCKUP_ABI,
      functionName: 'lockUpCount',
    }) as bigint;

    if (action === 'count') {
      return NextResponse.json({
        totalLockupCount: lockUpCount.toString(),
        currentBlock: currentBlock.toString(),
        currentTime,
        timestamp: new Date(currentTime * 1000).toISOString(),
      });
    }

    if (action === 'by-id' && lockupId) {
      try {
        const id = BigInt(lockupId);
        const lockUp = await client.readContract({
          address: LOCKUP_CONTRACT,
          abi: LOCKUP_ABI,
          functionName: 'lockUps',
          args: [id],
        }) as unknown as readonly [`0x${string}`, boolean, number, boolean, bigint, `0x${string}`, string];

        const [token, isERC20, unlockTime, unlocked, amount, receiverAddr, title] = lockUp;
        const unlockTimeNum = Number(unlockTime);
        const timeRemaining = unlockTimeNum - currentTime;

        return NextResponse.json({
          lockupId: lockupId,
          token: token,
          isERC20,
          unlockTime: unlockTimeNum,
          unlockTimeISO: new Date(unlockTimeNum * 1000).toISOString(),
          unlocked: unlocked,
          amount: amount.toString(),
          amountFormatted: parseFloat(formatUnits(amount, 18)).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
          receiver: receiverAddr,
          title: title,
          timeRemaining: timeRemaining,
          timeRemainingFormatted: timeRemaining <= 0 ? 'Expired' : `${Math.floor(timeRemaining / 86400)}d ${Math.floor((timeRemaining % 86400) / 3600)}h ${Math.floor((timeRemaining % 3600) / 60)}m`,
          isHigherToken: token.toLowerCase() === HIGHER_TOKEN_ADDRESS.toLowerCase(),
          currentTime,
          currentTimeISO: new Date(currentTime * 1000).toISOString(),
        });
      } catch (error: any) {
        return NextResponse.json({
          error: 'Failed to fetch lockup',
          lockupId,
          message: error.message,
        }, { status: 400 });
      }
    }

    if (action === 'by-receiver' && receiver) {
      try {
        const lockUpIds = await client.readContract({
          address: LOCKUP_CONTRACT,
          abi: LOCKUP_ABI,
          functionName: 'getLockUpIdsByReceiver',
          args: [receiver as `0x${string}`, BigInt(0), lockUpCount],
        }) as bigint[];

        const lockupPromises = lockUpIds.map(async (id: bigint) => {
          try {
            const lockUp = await client.readContract({
              address: LOCKUP_CONTRACT,
              abi: LOCKUP_ABI,
              functionName: 'lockUps',
              args: [id],
            }) as unknown as readonly [`0x${string}`, boolean, number, boolean, bigint, `0x${string}`, string];

            const [token, isERC20, unlockTime, unlocked, amount, receiverAddr, title] = lockUp;
            const unlockTimeNum = Number(unlockTime);
            const timeRemaining = unlockTimeNum - currentTime;

            return {
              lockupId: id.toString(),
              token: token,
              isERC20,
              unlockTime: unlockTimeNum,
              unlockTimeISO: new Date(unlockTimeNum * 1000).toISOString(),
              unlocked: unlocked,
              amount: amount.toString(),
              amountFormatted: parseFloat(formatUnits(amount, 18)).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }),
              receiver: receiverAddr,
              title: title || '',
              timeRemaining: timeRemaining,
              timeRemainingFormatted: timeRemaining <= 0 ? '🔓 Expired' : `${Math.floor(timeRemaining / 86400)}d ${Math.floor((timeRemaining % 86400) / 3600)}h ${Math.floor((timeRemaining % 3600) / 60)}m`,
              isHigherToken: token.toLowerCase() === HIGHER_TOKEN_ADDRESS.toLowerCase(),
            };
          } catch (error) {
            console.error(`Error fetching lockup ${id}:`, error);
            return null;
          }
        });

        const lockups = (await Promise.all(lockupPromises)).filter(l => l !== null);

        return NextResponse.json({
          receiver: receiver,
          lockupIds: lockUpIds.map(id => id.toString()),
          lockupsCount: lockups.length,
          lockups: lockups,
          higherLockups: lockups.filter(l => l.isHigherToken),
          currentTime,
          currentTimeISO: new Date(currentTime * 1000).toISOString(),
        });
      } catch (error: any) {
        return NextResponse.json({
          error: 'Failed to fetch lockups for receiver',
          receiver,
          message: error.message,
        }, { status: 400 });
      }
    }

    if (action === 'all-higher') {
      // This would be very slow for many lockups, but useful for debugging
      const allLockups: any[] = [];
      const batchSize = 100;
      
      for (let i = 0; i < Number(lockUpCount); i += batchSize) {
        const end = Math.min(i + batchSize, Number(lockUpCount));
        const batch = await Promise.all(
          Array.from({ length: end - i }, async (_, idx) => {
            const id = BigInt(i + idx + 1); // Lockup IDs are 1-indexed
            try {
              const lockUp = await client.readContract({
                address: LOCKUP_CONTRACT,
                abi: LOCKUP_ABI,
                functionName: 'lockUps',
                args: [id],
              }) as unknown as readonly [`0x${string}`, boolean, number, boolean, bigint, `0x${string}`, string];

              const [token, isERC20, unlockTime, unlocked, amount, receiver, title] = lockUp;
              if (token.toLowerCase() === HIGHER_TOKEN_ADDRESS.toLowerCase() && isERC20) {
                return {
                  lockupId: id.toString(),
                  unlockTime: Number(unlockTime),
                  unlocked: unlocked,
                  amount: amount.toString(),
                  receiver: receiver,
                };
              }
              return null;
            } catch (error) {
              return null;
            }
          })
        );
        
        allLockups.push(...batch.filter(l => l !== null));
        
        // Limit to first 500 for performance
        if (allLockups.length >= 500) break;
      }

      return NextResponse.json({
        totalLockupCount: lockUpCount.toString(),
        higherLockupsFound: allLockups.length,
        lockups: allLockups,
      });
    }

    return NextResponse.json({
      error: 'Invalid action',
      availableActions: ['count', 'by-receiver', 'by-id', 'all-higher'],
      usage: {
        count: '/api/user/lockup-debug?action=count',
        byReceiver: '/api/user/lockup-debug?action=by-receiver&receiver=0x...',
        byId: '/api/user/lockup-debug?action=by-id&id=123',
        allHigher: '/api/user/lockup-debug?action=all-higher',
      },
    }, { status: 400 });
  } catch (error: any) {
    console.error('Lockup debug API error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error.message,
        stack: error.stack,
      },
      { status: 500 }
    );
  }
}


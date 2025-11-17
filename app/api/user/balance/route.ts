import { NextRequest, NextResponse } from 'next/server';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { sql } from '@vercel/postgres';
import { convertAmount } from '@/lib/utils/token';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HIGHER_LOGO_URL = '/higher-logo.png';
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

function createCDPClient() {
  const clientKey =
    process.env.CDP_API_KEY_SECRET ||
    process.env.CDP_RPC_CLIENT_KEY ||
    process.env.CDP_RPC_API_KEY ||
    '';

  const rpcUrl = clientKey
    ? `https://api.developer.coinbase.com/rpc/v1/base/${clientKey}`
    : process.env.BASE_RPC_URL || 'https://mainnet.base.org';

  if (!clientKey) {
    console.warn('[user/balance] CDP client key not set, falling back to BASE_RPC_URL/public RPC');
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

type DbRow = {
  cast_hash: string;
  creator_fid: number;
  caster_stake_lockup_ids: number[] | null;
  caster_stake_amounts: any[] | null;
  caster_stake_unlock_times: number[] | null;
  caster_stake_unlocked: boolean[] | null;
  supporter_stake_lockup_ids: number[] | null;
  supporter_stake_amounts: any[] | null;
  supporter_stake_fids: number[] | null;
  supporter_stake_unlock_times: number[] | null;
  supporter_stake_unlocked: boolean[] | null;
};

type UserLockup = {
  lockupId: string;
  amount: string;
  unlockTime: number;
  castHash: string;
  stakeType: 'caster' | 'supporter';
  unlocked: boolean;
};

function normalizeAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.toLowerCase();
}

function asNumber(value: any, fallback = 0): number {
  const num = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isFinite(num) ? num : fallback;
}

function asBoolean(value: any, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    return normalized === 'true' || normalized === '1';
  }
  return fallback;
}

function toArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export async function GET(request: NextRequest) {
  try {
    const fidParam = request.nextUrl.searchParams.get('fid');
    if (!fidParam) {
      return NextResponse.json(
        { error: 'fid is required' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const fid = parseInt(fidParam, 10);
    if (Number.isNaN(fid)) {
      return NextResponse.json(
        { error: 'invalid fid' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const neynarApiKey = process.env.NEYNAR_API_KEY;
    if (!neynarApiKey) {
      return NextResponse.json(
        { error: 'NEYNAR_API_KEY not configured' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const neynar = new NeynarAPIClient({ apiKey: neynarApiKey });
    const userResponse = await neynar.fetchBulkUsers({ fids: [fid] });
    const user = userResponse.users?.[0];
    if (!user) {
      return NextResponse.json(
        { error: 'user not found' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const walletSet = new Set<string>();
    const custody = normalizeAddress(user.custody_address);
    if (custody) walletSet.add(custody);
    for (const addr of user.verified_addresses?.eth_addresses ?? []) {
      const normalized = normalizeAddress(addr);
      if (normalized) walletSet.add(normalized);
    }
    const walletAddresses = Array.from(walletSet);
    const walletBalanceMap = await fetchWalletBalances(walletAddresses);
    const walletEntries = walletAddresses.map((address) => {
      const amount = walletBalanceMap.get(address) ?? '0';
      return {
        address,
        balance: amount,
        balanceFormatted: amount,
      };
    });
    const walletTotal = walletEntries.reduce((sum, wallet) => {
      const value = Number(wallet.balance?.replace(/,/g, '') ?? wallet.balance);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);

    const result = await sql<DbRow>`
      SELECT
        cast_hash,
        creator_fid,
        caster_stake_lockup_ids,
        caster_stake_amounts,
        caster_stake_unlock_times,
        caster_stake_unlocked,
        supporter_stake_lockup_ids,
        supporter_stake_amounts,
        supporter_stake_fids,
        supporter_stake_unlock_times,
        supporter_stake_unlocked
      FROM leaderboard_entries
      WHERE creator_fid = ${fid} OR ${fid} = ANY(supporter_stake_fids)
    `;

    const lockups: UserLockup[] = [];

    for (const row of result.rows) {
      if (row.creator_fid === fid) {
        const lockupIds = toArray(row.caster_stake_lockup_ids);
        const amounts = toArray(row.caster_stake_amounts);
        const unlockTimes = toArray(row.caster_stake_unlock_times);
        const unlockedFlags = toArray(row.caster_stake_unlocked);

        for (let i = 0; i < lockupIds.length; i++) {
          const amount = convertAmount(amounts[i] ?? '0');
          lockups.push({
            lockupId: String(lockupIds[i]),
            amount,
            unlockTime: asNumber(unlockTimes[i]),
            castHash: row.cast_hash,
            stakeType: 'caster',
            unlocked: asBoolean(unlockedFlags[i]),
          });
        }
      }

      const supporterFids = toArray(row.supporter_stake_fids);
      const supporterLockupIds = toArray(row.supporter_stake_lockup_ids);
      const supporterAmounts = toArray(row.supporter_stake_amounts);
      const supporterUnlockTimes = toArray(row.supporter_stake_unlock_times);
      const supporterUnlocked = toArray(row.supporter_stake_unlocked);

      for (let i = 0; i < supporterFids.length; i++) {
        if (asNumber(supporterFids[i]) !== fid) continue;
        const amount = convertAmount(supporterAmounts[i] ?? '0');
        lockups.push({
          lockupId: String(supporterLockupIds[i]),
          amount,
          unlockTime: asNumber(supporterUnlockTimes[i]),
          castHash: row.cast_hash,
          stakeType: 'supporter',
          unlocked: asBoolean(supporterUnlocked[i]),
        });
      }
    }

    const totals = lockups.reduce(
      (acc, lockup) => {
        const amt = Number(lockup.amount);
        if (!Number.isFinite(amt)) return acc;
        acc.total += amt;
        if (!lockup.unlocked) {
          acc.locked += amt;
        }
        return acc;
      },
      { total: 0, locked: 0 },
    );

    const stakedTotal = totals.total;
    const lockedBalanceValue = totals.locked;
    const totalBalanceValue = stakedTotal + walletTotal;

    const totalBalanceString = totalBalanceValue.toString();
    const lockedBalanceString = lockedBalanceValue.toString();
    const walletBalanceString = walletTotal.toString();

    const responseBody = {
      totalBalance: totalBalanceString,
      totalBalanceFormatted: totalBalanceString,
      lockedBalance: lockedBalanceString,
      lockedBalanceFormatted: lockedBalanceString,
      walletBalance: walletBalanceString,
      walletBalanceFormatted: walletBalanceString,
      usdValue: '$0.00',
      pricePerToken: 0,
      higherLogoUrl: HIGHER_LOGO_URL,
      wallets: walletEntries,
      lockups: lockups.map((lockup) => ({
        lockupId: lockup.lockupId,
        amount: lockup.amount,
        amountFormatted: lockup.amount,
        unlockTime: lockup.unlockTime,
        receiver: lockup.stakeType,
        title: lockup.castHash,
        unlocked: lockup.unlocked,
      })),
    };

    return NextResponse.json(responseBody, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('[user/balance] error', error);
    return NextResponse.json(
      { error: error?.message || 'internal error' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

async function fetchWalletBalances(addresses: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (addresses.length === 0) {
    return map;
  }

  const client = createCDPClient();
  await Promise.all(
    addresses.map(async (address) => {
      try {
        const balance = await client.readContract({
          address: HIGHER_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address as `0x${string}`],
        });
        map.set(address, convertAmount(balance));
      } catch (err) {
        console.warn('[user/balance] Failed to fetch wallet balance for', address, err);
        map.set(address, '0');
      }
    }),
  );

  return map;
}



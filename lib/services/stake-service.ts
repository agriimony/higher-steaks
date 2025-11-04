import { HIGHER_TOKEN_ADDRESS } from '../contracts';
import { isValidCastHash } from '../cast-helpers';
import { getHigherCast } from './db-service';

export interface LockupData {
  lockupId: string;
  token: string;
  isERC20: boolean;
  unlockTime: number;
  unlocked: boolean;
  amount: bigint;
  receiver: string;
  title: string;
}

export type StakeType = 'caster' | 'supporter' | 'invalid';

/**
 * Check if a stake is valid
 * Valid if: (a) contains valid cast hash in title, (b) token = HIGHER, (c) currentTime < unlockTime
 */
export function isValidStake(lockup: LockupData, currentTime: number): boolean {
  // Check if title contains valid cast hash
  if (!isValidCastHash(lockup.title)) {
    return false;
  }

  // Check if token is HIGHER
  if (lockup.token.toLowerCase() !== HIGHER_TOKEN_ADDRESS.toLowerCase()) {
    return false;
  }

  // Check if already unlocked
  if (lockup.unlocked) {
    return false;
  }

  // Check if unlockTime hasn't passed
  if (currentTime >= lockup.unlockTime) {
    return false;
  }

  return true;
}

/**
 * Classify a stake as caster or supporter
 * Returns 'caster' if receiverAddress maps to caster fid, 'supporter' if not, 'invalid' if can't determine
 */
export async function classifyStake(
  lockupId: string,
  castHash: string,
  receiverAddress: string
): Promise<StakeType> {
  // Get cast from DB to find creator FID
  const cast = await getHigherCast(castHash);
  if (!cast) {
    // Can't classify without cast info
    return 'invalid';
  }

  const creatorFid = cast.creatorFid;

  // Map receiver address to FID using Neynar
  const receiverFid = await getFidFromAddress(receiverAddress);
  if (!receiverFid) {
    // Can't determine FID, but we can still classify based on known addresses
    // For now, return invalid if we can't map
    return 'invalid';
  }

  // If receiver FID matches creator FID, it's a caster stake
  if (receiverFid === creatorFid) {
    return 'caster';
  }

  return 'supporter';
}

/**
 * Get FID from Ethereum address using Neynar
 */
async function getFidFromAddress(address: string): Promise<number | null> {
  try {
    const neynarApiKey = process.env.NEYNAR_API_KEY;
    if (!neynarApiKey || neynarApiKey === 'your_neynar_api_key_here') {
      return null;
    }

    const { NeynarAPIClient } = await import('@neynar/nodejs-sdk');
    const neynarClient = new NeynarAPIClient({ apiKey: neynarApiKey });

    const users = await neynarClient.fetchBulkUsersByEthOrSolAddress({
      addresses: [address as `0x${string}`],
    });

    const userArray = users[address.toLowerCase()];
    if (userArray && userArray.length > 0) {
      return userArray[0].fid;
    }

    return null;
  } catch (error) {
    console.error('[stake-service] Error getting FID from address:', error);
    return null;
  }
}

/**
 * Batch get FIDs from addresses using Neynar
 */
export async function getFidsFromAddresses(addresses: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  if (addresses.length === 0) {
    return result;
  }

  try {
    const neynarApiKey = process.env.NEYNAR_API_KEY;
    if (!neynarApiKey || neynarApiKey === 'your_neynar_api_key_here') {
      return result;
    }

    const { NeynarAPIClient } = await import('@neynar/nodejs-sdk');
    const neynarClient = new NeynarAPIClient({ apiKey: neynarApiKey });

    // Batch in chunks of 350 (Neynar limit)
    const batchSize = 350;
    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      try {
        const users = await neynarClient.fetchBulkUsersByEthOrSolAddress({
          addresses: batch as `0x${string}`[],
        });

        for (const [address, userArray] of Object.entries(users)) {
          if (userArray && userArray.length > 0) {
            result.set(address.toLowerCase(), userArray[0].fid);
          }
        }
      } catch (error) {
        console.error(`[stake-service] Error fetching FIDs for batch ${i / batchSize}:`, error);
      }
    }

    return result;
  } catch (error) {
    console.error('[stake-service] Error batch getting FIDs from addresses:', error);
    return result;
  }
}

/**
 * Get all stakes for a cast from the database
 */
export async function getStakesForCast(castHash: string): Promise<{
  casterStakes: Array<{
    lockupId: string;
    amount: string;
    unlockTime: number;
  }>;
  supporterStakes: Array<{
    lockupId: string;
    amount: string;
    fid: number;
  }>;
}> {
  const cast = await getHigherCast(castHash);
  if (!cast) {
    return { casterStakes: [], supporterStakes: [] };
  }

  const currentTime = Math.floor(Date.now() / 1000);

  // Filter valid caster stakes (currentTime < unlockTime)
  const casterStakes = cast.casterStakeLockupIds
    .map((lockupId, index) => ({
      lockupId: lockupId.toString(),
      amount: cast.casterStakeAmounts[index] || '0',
      unlockTime: cast.casterStakeUnlockTimes[index] || 0,
    }))
    .filter(stake => stake.unlockTime > currentTime);

  // Filter valid supporter stakes (unlockTime > min caster stake unlockTime)
  const minCasterUnlockTime = cast.casterStakeUnlockTimes.length > 0
    ? Math.min(...cast.casterStakeUnlockTimes.filter(t => t > currentTime))
    : 0;

  const supporterStakes = cast.supporterStakeLockupIds
    .map((lockupId, index) => ({
      lockupId: lockupId.toString(),
      amount: cast.supporterStakeAmounts[index] || '0',
      fid: cast.supporterStakeFids[index] || 0,
    }))
    .filter((_, index) => {
      // Note: We'd need to store unlock times for supporter stakes to properly filter
      // Supporter stakes are only valid if unlockTime > min caster stake unlockTime
      // For now, we'll include all supporter stakes since unlock times aren't stored
      // This should be enhanced when we add supporter_stake_unlock_times column
      return true;
    });

  return { casterStakes, supporterStakes };
}

/**
 * Get min caster stake unlock time for a cast
 */
export async function getMinCasterStakeUnlockTime(castHash: string): Promise<number> {
  const cast = await getHigherCast(castHash);
  if (!cast || cast.casterStakeUnlockTimes.length === 0) {
    return 0;
  }

  const currentTime = Math.floor(Date.now() / 1000);
  const validUnlockTimes = cast.casterStakeUnlockTimes.filter(t => t > currentTime);

  if (validUnlockTimes.length === 0) {
    return 0;
  }

  return Math.min(...validUnlockTimes);
}


/**
 * Helper functions for supporter modal and stake calculations
 */

/**
 * Format max caster unlock time to readable format (e.g., "30d", "2w", "5h")
 */
export function formatTimeRemaining(maxUnlockTime: number): string {
  const currentTime = Math.floor(Date.now() / 1000);
  const secondsRemaining = maxUnlockTime - currentTime;
  
  if (secondsRemaining <= 0) {
    return 'Expired';
  }
  
  const days = Math.floor(secondsRemaining / 86400);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  
  if (years > 0) {
    return `${years}y`;
  } else if (months > 0) {
    return `${months}mo`;
  } else if (weeks > 0) {
    return `${weeks}w`;
  } else if (days > 0) {
    return `${days}d`;
  } else {
    const hours = Math.floor(secondsRemaining / 3600);
    return `${hours}h`;
  }
}

/**
 * Calculate duration from now to max unlock time, return { value, unit }
 */
export function calculateDurationToMatch(maxUnlockTime: number): { value: number; unit: 'minute' | 'day' | 'week' | 'month' | 'year' } {
  const currentTime = Math.floor(Date.now() / 1000);
  const secondsRemaining = maxUnlockTime - currentTime;
  
  if (secondsRemaining <= 0) {
    return { value: 0, unit: 'day' };
  }
  
  const days = secondsRemaining / 86400;
  const weeks = days / 7;
  const months = days / 30;
  const years = days / 365;
  
  if (years >= 1) {
    return { value: Math.round(years * 10) / 10, unit: 'year' };
  } else if (months >= 1) {
    return { value: Math.round(months * 10) / 10, unit: 'month' };
  } else if (weeks >= 1) {
    return { value: Math.round(weeks * 10) / 10, unit: 'week' };
  } else if (days >= 1) {
    return { value: Math.round(days * 10) / 10, unit: 'day' };
  } else {
    const minutes = secondsRemaining / 60;
    return { value: Math.round(minutes), unit: 'minute' };
  }
}

/**
 * Aggregate supporter stakes per FID, return sorted array with { fid, pfp, totalAmount }
 */
export function aggregateSupporterStakes(
  supporterStakeFids: number[],
  supporterStakeAmounts: string[],
  supporterStakePfps: string[]
): Array<{ fid: number; pfp: string; totalAmount: string }> {
  const aggregated = new Map<number, { fid: number; pfp: string; totalAmount: bigint }>();
  
  for (let i = 0; i < supporterStakeFids.length; i++) {
    const fid = supporterStakeFids[i];
    const amount = BigInt(supporterStakeAmounts[i] || '0');
    const pfp = supporterStakePfps[i] || '';
    
    if (aggregated.has(fid)) {
      const existing = aggregated.get(fid)!;
      existing.totalAmount += amount;
    } else {
      aggregated.set(fid, { fid, pfp, totalAmount: amount });
    }
  }
  
  // Convert to array and sort by total amount descending
  return Array.from(aggregated.values())
    .map(item => ({
      fid: item.fid,
      pfp: item.pfp,
      totalAmount: item.totalAmount.toString(),
    }))
    .sort((a, b) => {
      const aAmount = BigInt(a.totalAmount);
      const bAmount = BigInt(b.totalAmount);
      return aAmount > bAmount ? -1 : aAmount < bAmount ? 1 : 0;
    });
}

/**
 * Filter valid supporter stakes with both conditions:
 * 1. currentTime < unlockTime (stake has not expired)
 * 2. unlockTime > min caster stake unlockTime (supporter must be staked longer than min caster stake)
 * 
 * Note: This function requires unlock times for supporter stakes, which may not be available in the database.
 * For now, we'll filter based on what we can verify.
 */
export function filterValidSupporterStakes(
  supporterStakes: Array<{ fid: number; pfp: string; totalAmount: string; unlockTime?: number }>,
  minCasterUnlockTime: number,
  currentTime: number
): Array<{ fid: number; pfp: string; totalAmount: string }> {
  return supporterStakes.filter(stake => {
    // Condition 1: stake has not expired (if unlockTime is available)
    if (stake.unlockTime !== undefined && stake.unlockTime <= currentTime) {
      return false;
    }
    
    // Condition 2: unlockTime > min caster stake unlockTime (if unlockTime is available)
    if (stake.unlockTime !== undefined && stake.unlockTime <= minCasterUnlockTime) {
      return false;
    }
    
    // If unlockTime is not available, we can't filter, so include it
    // This will be enhanced when we add supporter_stake_unlock_times column
    return true;
  });
}

/**
 * Calculate weighted stake in higher-days (cumulative time-weighted stake to date)
 * Formula: (stake_amount_in_tokens) * (min(now, unlock_time) - lock_time) / 86400
 * 
 * This handles all cases:
 * - Active stakes: uses current time (now - lock_time)
 * - Expired/unlocked stakes: uses unlock_time (full period until unlock)
 * 
 * @param amount - Stake amount in wei
 * @param lockTime - Unix timestamp when stake was locked
 * @param unlockTime - Unix timestamp when stake unlocks
 * @param currentTime - Current unix timestamp (defaults to now)
 * @returns Weighted stake in higher-days (tokens * days)
 */
export function calculateWeightedStake(
  amount: bigint, // in wei
  lockTime: number, // unix timestamp
  unlockTime: number, // unix timestamp
  currentTime: number = Math.floor(Date.now() / 1000)
): number {
  // Calculate stake period: min(now, unlock_time) - lock_time
  // This handles all cases: active (now < unlock_time), expired (now > unlock_time), unlocked
  const stakePeriod = Math.min(currentTime, unlockTime) - lockTime;
  
  // Ensure non-negative period (handle edge cases where lockTime > unlockTime or lockTime > currentTime)
  if (stakePeriod <= 0) {
    return 0;
  }
  
  const stakePeriodDays = stakePeriod / 86400; // Convert seconds to days
  const amountInTokens = Number(amount) / 1e18; // Convert wei to tokens
  return amountInTokens * stakePeriodDays; // Returns cumulative time-weighted stake
}


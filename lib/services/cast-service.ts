import { getHigherCast, castExistsInDB } from './db-service';
import { isValidCastHash, containsKeyphrase, extractDescription, isValidHigherCast } from '../cast-helpers';

export interface CastData {
  hash: string;
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
  castText: string;
  description: string;
  timestamp: string;
  valid: boolean;
  state: 'invalid' | 'valid' | 'higher' | 'expired';
}

export interface ValidateCastResult {
  valid: boolean;
  reason?: string;
  castData?: CastData;
}

/**
 * Get cast by hash - checks leaderboard_entries first, falls back to Neynar
 */
export async function getCastByHash(hash: string): Promise<CastData | null> {
  // Check database first
  const dbCast = await getHigherCast(hash);
  if (dbCast) {
    return {
      hash: dbCast.castHash,
      fid: dbCast.creatorFid,
      username: dbCast.creatorUsername,
      displayName: dbCast.creatorDisplayName,
      pfpUrl: dbCast.creatorPfpUrl,
      castText: dbCast.castText,
      description: dbCast.description,
      timestamp: dbCast.castTimestamp,
      valid: true,
      state: dbCast.castState,
    };
  }

  // Fallback to Neynar (minimal - mostly onboarding flow)
  return await validateCastFromNeynar(hash);
}

/**
 * Validate cast - checks database first, falls back to Neynar
 */
export async function validateCast(hash: string): Promise<ValidateCastResult> {
  // Skip hash validation for URLs (they'll be handled by Neynar)
  const isUrl = hash.includes('farcaster.xyz') || hash.includes('warpcast.com');
  
  if (!isUrl && !isValidCastHash(hash)) {
    return {
      valid: false,
      reason: 'Invalid cast hash format',
    };
  }

  // If it's a URL, skip database check and go straight to Neynar
  if (isUrl) {
    const neynarCast = await validateCastFromNeynar(hash);
    if (neynarCast) {
      return {
        valid: true,
        castData: neynarCast,
      };
    }
    return {
      valid: false,
      reason: 'Cast not found or invalid',
    };
  }

  // Check database first (for hash-based lookups)
  const dbCast = await getHigherCast(hash);
  if (dbCast) {
    return {
      valid: true,
      castData: {
        hash: dbCast.castHash,
        fid: dbCast.creatorFid,
        username: dbCast.creatorUsername,
        displayName: dbCast.creatorDisplayName,
        pfpUrl: dbCast.creatorPfpUrl,
        castText: dbCast.castText,
        description: dbCast.description,
        timestamp: dbCast.castTimestamp,
        valid: true,
        state: dbCast.castState,
      },
    };
  }

  // Fallback to Neynar validation
  const neynarCast = await validateCastFromNeynar(hash);
  if (neynarCast) {
    return {
      valid: true,
      castData: neynarCast,
    };
  }

  return {
    valid: false,
    reason: 'Cast not found or invalid',
  };
}

/**
 * Determine cast state based on DB + onchain data
 */
export async function determineCastState(hash: string): Promise<'invalid' | 'valid' | 'higher' | 'expired'> {
  const dbCast = await getHigherCast(hash);
  if (dbCast) {
    return dbCast.castState;
  }

  // Check if cast is valid via Neynar
  const neynarCast = await validateCastFromNeynar(hash);
  if (neynarCast && neynarCast.valid) {
    // Valid but not "higher" yet (no caster stake)
    return 'valid';
  }

  return 'invalid';
}

/**
 * Check if cast is "higher" (has valid caster stake)
 */
export async function isCastHigher(hash: string): Promise<boolean> {
  const dbCast = await getHigherCast(hash);
  if (!dbCast) {
    return false;
  }

  // Check if there are any valid caster stakes (currentTime < unlockTime)
  const currentTime = Math.floor(Date.now() / 1000);
  const hasValidCasterStake = dbCast.casterStakeUnlockTimes.some(
    unlockTime => unlockTime > currentTime
  );

  return hasValidCasterStake && dbCast.castState === 'higher';
}

/**
 * Validate cast from Neynar API (fallback when not in DB)
 */
export async function validateCastFromNeynar(hash: string): Promise<CastData | null> {
  try {
    const neynarApiKey = process.env.NEYNAR_API_KEY;
    if (!neynarApiKey || neynarApiKey === 'your_neynar_api_key_here') {
      console.warn('[cast-service] Neynar API key not configured');
      return null;
    }

    const { NeynarAPIClient } = await import('@neynar/nodejs-sdk');
    const neynarClient = new NeynarAPIClient({ apiKey: neynarApiKey });

    // Determine lookup type - if it's a URL, use 'url', otherwise use 'hash'
    const lookupType = hash.includes('farcaster.xyz') || hash.includes('warpcast.com') ? 'url' : 'hash';

    let castResponse;
    try {
      castResponse = await neynarClient.lookupCastByHashOrUrl({
        identifier: hash,
        type: lookupType,
      });
    } catch (firstError: any) {
      // If URL type failed, try hash type as fallback
      if (lookupType === 'url' && firstError.message?.includes('400')) {
        console.log('[cast-service] URL type failed, trying hash type instead');
        castResponse = await neynarClient.lookupCastByHashOrUrl({
          identifier: hash,
          type: 'hash',
        });
      } else {
        throw firstError;
      }
    }

    const cast = castResponse.cast;
    if (!cast) {
      return null;
    }

    // Use consolidated validation function (validates both keyphrase and channel)
    if (!isValidHigherCast(cast.text, cast)) {
      return null;
    }

    const description = extractDescription(cast.text) || '';

    return {
      hash: cast.hash,
      fid: cast.author.fid,
      username: cast.author.username,
      displayName: cast.author.display_name || cast.author.username,
      pfpUrl: cast.author.pfp_url || '',
      castText: cast.text,
      description,
      timestamp: cast.timestamp,
      valid: true,
      state: 'valid', // Not "higher" yet since it's not in DB
    };
  } catch (error) {
    console.error('[cast-service] Error validating cast from Neynar:', error);
    return null;
  }
}


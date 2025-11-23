import { KEYPHRASE_REGEX, KEYPHRASE_TEXT } from './constants';

// Re-export constants for convenience
export { KEYPHRASE_REGEX, KEYPHRASE_TEXT };

/**
 * Validates if a string is a valid cast hash (42 chars, starts with 0x)
 */
export function isValidCastHash(hash: string): boolean {
  return typeof hash === 'string' && hash.length === 42 && hash.startsWith('0x');
}

/**
 * Validates if cast text contains the required keyphrase
 */
export function containsKeyphrase(castText: string): boolean {
  return KEYPHRASE_REGEX.test(castText);
}

/**
 * Validates if a cast is from the /higher channel
 */
export function isHigherChannel(cast: { channel?: { id?: string } | null; parent_url?: string | null }): boolean {
  return cast.channel?.id === 'higher' || (cast.parent_url?.includes('/higher') ?? false);
}

/**
 * Consolidated validation function for higher casts
 * Validates both keyphrase and channel in one place
 * This is the single source of truth for validating higher casts
 */
export function isValidHigherCast(
  castText: string,
  cast: { channel?: { id?: string } | null; parent_url?: string | null }
): boolean {
  return containsKeyphrase(castText) && isHigherChannel(cast);
}

/**
 * Extracts description from cast text after keyphrase
 */
export function extractDescription(castText: string): string | null {
  const match = castText.match(KEYPHRASE_REGEX);
  return match ? match[1].trim() : null;
}

/**
 * Fetches cast data from the new /api/cast/[hash] endpoint
 * Returns null if cast not found or invalid
 */
export async function fetchValidCast(castHash: string): Promise<{
  castText: string;
  description: string;
  author: { fid: number; username: string };
} | null> {
  if (!isValidCastHash(castHash)) {
    return null;
  }

  try {
    const response = await fetch(`/api/cast/${castHash}`);
    if (!response.ok) {
      if (response.status === 404) {
        // Cast not found in database or via Neynar
        return null;
      }
      return null;
    }
    
    const data = await response.json();
    if (!data.valid || !data.castText || !containsKeyphrase(data.castText)) {
      return null;
    }

    return {
      castText: data.castText,
      description: data.description || extractDescription(data.castText) || '',
      author: {
        fid: data.fid,
        username: data.username || 'unknown',
      },
    };
  } catch (error) {
    console.error('Error fetching cast:', error);
    return null;
  }
}

/**
 * Truncates text to fit within one line (max chars)
 */
export function truncateCastText(text: string, maxLength: number = 80): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}


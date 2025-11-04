import { sql } from '@vercel/postgres';

export interface HigherCastData {
  castHash: string;
  creatorFid: number;
  creatorUsername: string;
  creatorDisplayName: string;
  creatorPfpUrl: string;
  castText: string;
  description: string;
  castTimestamp: string;
  totalHigherStaked: string;
  usdValue: string | null;
  rank: number | null;
  casterStakeLockupIds: number[];
  casterStakeAmounts: string[];
  casterStakeUnlockTimes: number[];
  supporterStakeLockupIds: number[];
  supporterStakeAmounts: string[];
  supporterStakeFids: number[];
  supporterStakePfps: string[];
  castState: 'invalid' | 'valid' | 'higher';
}

/**
 * Get a higher cast from the database by hash
 */
export async function getHigherCast(hash: string): Promise<HigherCastData | null> {
  try {
    const result = await sql`
      SELECT 
        cast_hash,
        creator_fid,
        creator_username,
        creator_display_name,
        creator_pfp_url,
        cast_text,
        description,
        cast_timestamp,
        total_higher_staked,
        usd_value,
        rank,
        caster_stake_lockup_ids,
        caster_stake_amounts,
        caster_stake_unlock_times,
        supporter_stake_lockup_ids,
        supporter_stake_amounts,
        supporter_stake_fids,
        supporter_stake_pfps,
        cast_state
      FROM leaderboard_entries
      WHERE cast_hash = ${hash}
      LIMIT 1
    `;

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      castHash: row.cast_hash,
      creatorFid: row.creator_fid,
      creatorUsername: row.creator_username,
      creatorDisplayName: row.creator_display_name || row.creator_username,
      creatorPfpUrl: row.creator_pfp_url || '',
      castText: row.cast_text,
      description: row.description,
      castTimestamp: row.cast_timestamp,
      totalHigherStaked: row.total_higher_staked?.toString() || '0',
      usdValue: row.usd_value?.toString() || null,
      rank: row.rank || null,
      casterStakeLockupIds: row.caster_stake_lockup_ids || [],
      casterStakeAmounts: row.caster_stake_amounts?.map((a: any) => a.toString()) || [],
      casterStakeUnlockTimes: row.caster_stake_unlock_times || [],
      supporterStakeLockupIds: row.supporter_stake_lockup_ids || [],
      supporterStakeAmounts: row.supporter_stake_amounts?.map((a: any) => a.toString()) || [],
      supporterStakeFids: row.supporter_stake_fids || [],
      supporterStakePfps: row.supporter_stake_pfps || [],
      castState: (row.cast_state || 'higher') as 'invalid' | 'valid' | 'higher',
    };
  } catch (error) {
    console.error('[db-service] Error getting higher cast:', error);
    return null;
  }
}

/**
 * Check if a cast hash exists in the database
 */
export async function castExistsInDB(hash: string): Promise<boolean> {
  try {
    const result = await sql`
      SELECT 1 FROM leaderboard_entries
      WHERE cast_hash = ${hash}
      LIMIT 1
    `;
    return result.rows.length > 0;
  } catch (error) {
    console.error('[db-service] Error checking cast existence:', error);
    return false;
  }
}

/**
 * Upsert a higher cast into the database
 * 
 * Column relationships:
 * - total_higher_staked = sum of all caster_stake_amounts + sum of all supporter_stake_amounts
 * - staker_fids = [creator_fid, ...supporter_stake_fids] (for backward compatibility)
 * - supporter_stake_pfps = array of profile picture URLs corresponding to supporter_stake_fids (same order)
 */
export async function upsertHigherCast(data: {
  castHash: string;
  creatorFid: number;
  creatorUsername: string;
  creatorDisplayName?: string;
  creatorPfpUrl?: string;
  castText: string;
  description: string;
  castTimestamp: string;
  totalHigherStaked: number;
  usdValue?: number;
  rank?: number;
  casterStakeLockupIds?: number[];
  casterStakeAmounts?: string[];
  casterStakeUnlockTimes?: number[];
  supporterStakeLockupIds?: number[];
  supporterStakeAmounts?: string[];
  supporterStakeFids?: number[];
  supporterStakePfps?: string[]; // Array of PFP URLs corresponding to supporter_stake_fids (same order)
  stakerFids?: number[]; // For backward compatibility: [creator_fid, ...supporter_stake_fids]
  castState?: 'invalid' | 'valid' | 'higher';
}): Promise<void> {
  try {
    // Calculate staker_fids if not provided (backward compatibility)
    const stakerFids = data.stakerFids || [
      data.creatorFid,
      ...(data.supporterStakeFids || [])
    ].filter((fid, index, arr) => arr.indexOf(fid) === index); // Remove duplicates
    
    await sql`
      INSERT INTO leaderboard_entries (
        cast_hash,
        creator_fid,
        creator_username,
        creator_display_name,
        creator_pfp_url,
        cast_text,
        description,
        cast_timestamp,
        total_higher_staked,
        usd_value,
        rank,
        staker_fids,
        caster_stake_lockup_ids,
        caster_stake_amounts,
        caster_stake_unlock_times,
        supporter_stake_lockup_ids,
        supporter_stake_amounts,
        supporter_stake_fids,
        supporter_stake_pfps,
        cast_state,
        updated_at
      ) VALUES (
        ${data.castHash},
        ${data.creatorFid},
        ${data.creatorUsername},
        ${data.creatorDisplayName || data.creatorUsername},
        ${data.creatorPfpUrl || ''},
        ${data.castText},
        ${data.description},
        ${data.castTimestamp},
        ${data.totalHigherStaked},
        ${data.usdValue || null},
        ${data.rank || null},
        ${stakerFids as any},
        ${(data.casterStakeLockupIds || []) as any},
        ${(data.casterStakeAmounts || []) as any},
        ${(data.casterStakeUnlockTimes || []) as any},
        ${(data.supporterStakeLockupIds || []) as any},
        ${(data.supporterStakeAmounts || []) as any},
        ${(data.supporterStakeFids || []) as any},
        ${(data.supporterStakePfps || []) as any},
        ${data.castState || 'higher'},
        NOW()
      )
      ON CONFLICT (cast_hash) DO UPDATE SET
        creator_fid = EXCLUDED.creator_fid,
        creator_username = EXCLUDED.creator_username,
        creator_display_name = EXCLUDED.creator_display_name,
        creator_pfp_url = EXCLUDED.creator_pfp_url,
        cast_text = EXCLUDED.cast_text,
        description = EXCLUDED.description,
        cast_timestamp = EXCLUDED.cast_timestamp,
        total_higher_staked = EXCLUDED.total_higher_staked,
        usd_value = EXCLUDED.usd_value,
        rank = EXCLUDED.rank,
        staker_fids = EXCLUDED.staker_fids,
        caster_stake_lockup_ids = EXCLUDED.caster_stake_lockup_ids,
        caster_stake_amounts = EXCLUDED.caster_stake_amounts,
        caster_stake_unlock_times = EXCLUDED.caster_stake_unlock_times,
        supporter_stake_lockup_ids = EXCLUDED.supporter_stake_lockup_ids,
        supporter_stake_amounts = EXCLUDED.supporter_stake_amounts,
        supporter_stake_fids = EXCLUDED.supporter_stake_fids,
        supporter_stake_pfps = EXCLUDED.supporter_stake_pfps,
        cast_state = EXCLUDED.cast_state,
        updated_at = NOW()
    `;
  } catch (error) {
    console.error('[db-service] Error upserting higher cast:', error);
    throw error;
  }
}


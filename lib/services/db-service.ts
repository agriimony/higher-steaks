import { sql, createClient } from '@vercel/postgres';

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
	casterStakeUnlocked: boolean[];
	// NEW: lock times
	casterStakeLockTimes?: number[];
	supporterStakeLockupIds: number[];
	supporterStakeAmounts: string[];
	supporterStakeFids: number[];
	supporterStakeUnlockTimes: number[];
	supporterStakeUnlocked: boolean[];
	// NEW: lock times
	supporterStakeLockTimes?: number[];
	castState: 'invalid' | 'valid' | 'higher' | 'expired';
}

/**
 * Get a higher cast from the database by hash
 * Uses non-pooling connection to avoid stale data issues
 */
export async function getHigherCast(hash: string): Promise<HigherCastData | null> {
	let client;
	try {
		// Use non-pooling connection for fresh data
		if (process.env.POSTGRES_URL_NON_POOLING) {
			client = createClient({
				connectionString: process.env.POSTGRES_URL_NON_POOLING,
			});
			await client.connect();
		}

		const query = client 
			? client.sql`
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
					caster_stake_unlocked,
					caster_stake_lock_times,
					supporter_stake_lockup_ids,
					supporter_stake_amounts,
					supporter_stake_fids,
					supporter_stake_unlock_times,
					supporter_stake_unlocked,
					supporter_stake_lock_times,
					cast_state
				FROM leaderboard_entries
				WHERE cast_hash = ${hash}
				LIMIT 1
			`
			: sql`
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
					caster_stake_unlocked,
					caster_stake_lock_times,
					supporter_stake_lockup_ids,
					supporter_stake_amounts,
					supporter_stake_fids,
					supporter_stake_unlock_times,
					supporter_stake_unlocked,
					supporter_stake_lock_times,
					cast_state
				FROM leaderboard_entries
				WHERE cast_hash = ${hash}
				LIMIT 1
			`;

		const result = await query;

		if (result.rows.length === 0) {
			console.log(`[db-service] No cast found for hash: ${hash}`);
			return null;
		}

		const row = result.rows[0];
		console.log(`[db-service] Found cast for hash: ${hash}, cast_state: ${row.cast_state}`);
		
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
			casterStakeUnlocked: row.caster_stake_unlocked || [],
			casterStakeLockTimes: row.caster_stake_lock_times || [],
			supporterStakeLockupIds: row.supporter_stake_lockup_ids || [],
			supporterStakeAmounts: row.supporter_stake_amounts?.map((a: any) => a.toString()) || [],
			supporterStakeFids: row.supporter_stake_fids || [],
			supporterStakeUnlockTimes: row.supporter_stake_unlock_times || [],
			supporterStakeUnlocked: row.supporter_stake_unlocked || [],
			supporterStakeLockTimes: row.supporter_stake_lock_times || [],
			castState: (row.cast_state || 'higher') as 'invalid' | 'valid' | 'higher' | 'expired',
		};
	} catch (error) {
		console.error('[db-service] Error getting higher cast:', error);
		console.error('[db-service] Hash:', hash);
		if (error instanceof Error) {
			console.error('[db-service] Error message:', error.message);
			console.error('[db-service] Error stack:', error.stack);
		}
		return null;
	} finally {
		// Always close the connection if we created one
		if (client) {
			try {
				await client.end();
			} catch (closeError) {
				console.error('[db-service] Error closing connection:', closeError);
			}
		}
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
	casterStakeUnlocked?: boolean[];
	// NEW
	casterStakeLockTimes?: number[];
	supporterStakeLockupIds?: number[];
	supporterStakeAmounts?: string[];
	supporterStakeFids?: number[];
	supporterStakeUnlockTimes?: number[];
	supporterStakeUnlocked?: boolean[];
	// NEW
	supporterStakeLockTimes?: number[];
	stakerFids?: number[]; // For backward compatibility: [creator_fid, ...supporter_stake_fids]
	castState?: 'invalid' | 'valid' | 'higher' | 'expired';
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
        caster_stake_unlocked,
        caster_stake_lock_times,
        supporter_stake_lockup_ids,
        supporter_stake_amounts,
        supporter_stake_fids,
        supporter_stake_unlock_times,
        supporter_stake_unlocked,
        supporter_stake_lock_times,
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
        ${(data.casterStakeUnlocked || []) as any},
        ${(data.casterStakeLockTimes || []) as any},
        ${(data.supporterStakeLockupIds || []) as any},
        ${(data.supporterStakeAmounts || []) as any},
        ${(data.supporterStakeFids || []) as any},
        ${(data.supporterStakeUnlockTimes || []) as any},
        ${(data.supporterStakeUnlocked || []) as any},
        ${(data.supporterStakeLockTimes || []) as any},
        ${data.castState || 'higher'},
        NOW()
      )
      ON CONFLICT (cast_hash) DO UPDATE SET
        creator_fid = EXCLUDED.creator_fid,
        -- Preserve existing metadata if new values are null/empty (cast deleted/expired in Farcaster)
        creator_username = COALESCE(NULLIF(EXCLUDED.creator_username, ''), leaderboard_entries.creator_username),
        creator_display_name = COALESCE(NULLIF(EXCLUDED.creator_display_name, ''), leaderboard_entries.creator_display_name),
        creator_pfp_url = COALESCE(NULLIF(EXCLUDED.creator_pfp_url, ''), leaderboard_entries.creator_pfp_url),
        cast_text = COALESCE(NULLIF(EXCLUDED.cast_text, ''), leaderboard_entries.cast_text),
        description = COALESCE(NULLIF(EXCLUDED.description, ''), leaderboard_entries.description),
        cast_timestamp = COALESCE(EXCLUDED.cast_timestamp, leaderboard_entries.cast_timestamp),
        total_higher_staked = EXCLUDED.total_higher_staked,
        usd_value = EXCLUDED.usd_value,
        rank = EXCLUDED.rank,
        staker_fids = EXCLUDED.staker_fids,
        caster_stake_lockup_ids = EXCLUDED.caster_stake_lockup_ids,
        caster_stake_amounts = EXCLUDED.caster_stake_amounts,
        caster_stake_unlock_times = EXCLUDED.caster_stake_unlock_times,
        caster_stake_unlocked = EXCLUDED.caster_stake_unlocked,
        caster_stake_lock_times = EXCLUDED.caster_stake_lock_times,
        supporter_stake_lockup_ids = EXCLUDED.supporter_stake_lockup_ids,
        supporter_stake_amounts = EXCLUDED.supporter_stake_amounts,
        supporter_stake_fids = EXCLUDED.supporter_stake_fids,
        supporter_stake_unlock_times = EXCLUDED.supporter_stake_unlock_times,
        supporter_stake_unlocked = EXCLUDED.supporter_stake_unlocked,
        supporter_stake_lock_times = EXCLUDED.supporter_stake_lock_times,
        cast_state = EXCLUDED.cast_state,
        updated_at = NOW()
    `;
	} catch (error) {
		console.error('[db-service] Error upserting higher cast:', error);
		throw error;
	}
}

/**
 * Get lockup unlocked state (caster or supporter) for a given cast hash + lockupId.
 * Returns null if not found.
 */
export async function getLockupUnlockedState(castHash: string, lockupId: number): Promise<{
	type: 'caster' | 'supporter' | null;
	unlocked: boolean | null;
}> {
	const cast = await getHigherCast(castHash);
	if (!cast) {
		return { type: null, unlocked: null };
	}

	const casterIndex = cast.casterStakeLockupIds.findIndex(id => Number(id) === Number(lockupId));
	if (casterIndex !== -1) {
		const unlocked = cast.casterStakeUnlocked?.[casterIndex] ?? false;
		return { type: 'caster', unlocked };
	}

	const supporterIndex = cast.supporterStakeLockupIds.findIndex(id => Number(id) === Number(lockupId));
	if (supporterIndex !== -1) {
		const unlocked = cast.supporterStakeUnlocked?.[supporterIndex] ?? false;
		return { type: 'supporter', unlocked };
	}

	return { type: null, unlocked: null };
}

/**
 * Update the unlocked boolean for a specific lockup in the leaderboard entry.
 * type: 'caster' or 'supporter'. Returns true if updated.
 */
export async function updateLockupUnlockedState(castHash: string, params: {
	type: 'caster' | 'supporter';
	lockupId: number;
	unlocked: boolean;
}): Promise<boolean> {
	const cast = await getHigherCast(castHash);
	if (!cast) {
		return false;
	}

	if (params.type === 'caster') {
		const idx = cast.casterStakeLockupIds.findIndex(id => Number(id) === Number(params.lockupId));
		if (idx === -1) return false;
		const updated = [...(cast.casterStakeUnlocked || [])];
		updated[idx] = params.unlocked;
		await sql`
      UPDATE leaderboard_entries
      SET caster_stake_unlocked = ${updated as any}, updated_at = NOW()
      WHERE cast_hash = ${castHash}
    `;
		return true;
	}

	if (params.type === 'supporter') {
		const idx = cast.supporterStakeLockupIds.findIndex(id => Number(id) === Number(params.lockupId));
		if (idx === -1) return false;
		const updated = [...(cast.supporterStakeUnlocked || [])];
		updated[idx] = params.unlocked;
		await sql`
      UPDATE leaderboard_entries
      SET supporter_stake_unlocked = ${updated as any}, updated_at = NOW()
      WHERE cast_hash = ${castHash}
    `;
		return true;
	}

	return false;
}


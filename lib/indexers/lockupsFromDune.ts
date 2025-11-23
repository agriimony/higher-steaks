import { fetchAllLatestResults, DuneRow } from '../dune';
import { formatUnits } from 'viem';
import { upsertHigherCast, getHigherCast } from '../services/db-service';
import { getCastByHash } from '../services/cast-service';
import { getFidsFromAddresses } from '../services/stake-service';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';

// Query and columns per plan
const DUNE_QUERY_ID = 6214515;
const DUNE_COLUMNS = [
	'sender',
	'lockTime',
	'lockUpId',
	'title',
	'amount',
	'receiver',
	'unlockTime',
	'unlocked',
];

// Helper: normalize cast hash string from title
function normalizeCastHash(title: string | null | undefined): string | null {
	if (!title) return null;
	let s = String(title).trim().toLowerCase();
	if (!s) return null;
	if (!s.startsWith('0x')) {
		if (/^[0-9a-f]+$/i.test(s)) s = '0x' + s;
		else return null;
	}
	return s as string;
}

// Resolve fid owner and wallet associations for caster/supporter classification
async function resolveCastOwnerAndWallets(castHash: string): Promise<{ ownerFid: number | null; ownerWallets: Set<string> }> {
	try {
		const cast = await getCastByHash(castHash); // may hit DB first, fallback to Neynar
		if (!cast) {
			return { ownerFid: null, ownerWallets: new Set() };
		}
		const ownerFid = cast.fid;
		// Hydrate owner wallets (custody + verified) via Neynar
		const wallets = await fetchWalletsForFid(ownerFid);
		return { ownerFid, ownerWallets: wallets };
	} catch (err) {
		// If lookup fails (e.g., 404 from Neynar), treat as unresolved and skip later
		return { ownerFid: null, ownerWallets: new Set() };
	}
}

async function fetchWalletsForFid(fid: number): Promise<Set<string>> {
	try {
		const apiKey = process.env.NEYNAR_API_KEY;
		if (!apiKey) return new Set();
		const client = new NeynarAPIClient({ apiKey });
		const res = await client.fetchBulkUsers({ fids: [fid] });
		const u = res.users?.[0];
		if (!u) return new Set();
		const addrs = new Set<string>();
		if (u.custody_address) addrs.add(String(u.custody_address).toLowerCase());
		for (const v of (u.verified_addresses?.eth_addresses ?? [])) {
			addrs.add(String(v).toLowerCase());
		}
		return addrs;
	} catch {
		return new Set();
	}
}

function isTruthyBoolean(v: any): boolean {
	if (typeof v === 'boolean') return v;
	if (typeof v === 'string') return v.toLowerCase() === 'true' || v === '1';
	if (typeof v === 'number') return v !== 0;
	return false;
}

function toInt(v: any): number {
	const n = typeof v === 'number' ? v : parseInt(String(v || '0'), 10);
	return Number.isFinite(n) ? n : 0;
}

export interface AggregatedCast {
	castHash: string;
	creatorFid: number; // from cast owner
	creatorUsername: string;
	creatorDisplayName?: string;
	creatorPfpUrl?: string;
	castText: string;
	description: string;
	castTimestamp: string;
	totalHigherStaked: number;
	casterStakeLockupIds: number[];
	casterStakeAmounts: string[];
	casterStakeUnlockTimes: number[];
	casterStakeLockTimes: number[];
	casterStakeUnlocked: boolean[];
	supporterStakeLockupIds: number[];
	supporterStakeAmounts: string[];
	supporterStakeFids: number[]; // can be left empty if unknown
	supporterStakeUnlockTimes: number[];
	supporterStakeLockTimes: number[];
	supporterStakeUnlocked: boolean[];
	castState: 'invalid' | 'valid' | 'higher' | 'expired';
}

export async function fetchAndAggregateLockupsFromDune(): Promise<Map<string, AggregatedCast>> {
	const rows = await fetchAllLatestResults(DUNE_QUERY_ID, {
		columns: DUNE_COLUMNS,
		limit: 1000,
	});

	// Group rows by cast hash (title)
	const grouped: Map<string, DuneRow[]> = new Map();
	for (const r of rows) {
		const castHash = normalizeCastHash(r.title);
		if (!castHash) continue;
		if (!grouped.has(castHash)) grouped.set(castHash, []);
		grouped.get(castHash)!.push(r);
	}

	const result = new Map<string, AggregatedCast>();

	for (const [castHash, castRows] of grouped.entries()) {
		const { ownerFid, ownerWallets } = await resolveCastOwnerAndWallets(castHash);
		let castMeta = null as Awaited<ReturnType<typeof getCastByHash>> | null;
		try {
			castMeta = await getCastByHash(castHash); // for display fields if available
		} catch {
			castMeta = null;
		}

		// If we couldn't resolve cast owner and have no metadata, skip this cast hash
		if (ownerFid == null && !castMeta) {
			continue;
		}

		// Batch map unique senders to FIDs for this cast
		const uniqueSenders = Array.from(new Set(castRows.map(r => String(r.sender || '').toLowerCase()).filter(Boolean)));
		const senderToFid = uniqueSenders.length > 0 ? await getFidsFromAddresses(uniqueSenders) : new Map<string, number>();

		const casterStakeLockupIds: number[] = [];
		const casterStakeAmounts: string[] = [];
		const casterStakeUnlockTimes: number[] = [];
		const casterStakeLockTimes: number[] = [];
		const casterStakeUnlocked: boolean[] = [];

		const supporterStakeLockupIds: number[] = [];
		const supporterStakeAmounts: string[] = [];
		const supporterStakeFids: number[] = [];
		const supporterStakeUnlockTimes: number[] = [];
		const supporterStakeLockTimes: number[] = [];
		const supporterStakeUnlocked: boolean[] = [];

		let totalHigherStaked = 0;

		for (const r of castRows) {
			const amount = String(r.amount ?? '0');
			// Dune may return token amount in wei or decimals depending on query; we keep a string but compute number for totals using formatUnits(wei,18) if it looks like bigint
			let amountNum = 0;
			try {
				// attempt format as wei
				amountNum = parseFloat(formatUnits(BigInt(amount), 18));
			} catch {
				// fallback to parseFloat directly
				amountNum = parseFloat(amount);
			}
			totalHigherStaked += isFinite(amountNum) ? amountNum : 0;

			const sender = String(r.sender || '').toLowerCase();
			const senderFid = senderToFid.get(sender) || 0;
			const lockUpId = toInt(r.lockUpId);
			const unlockTime = toInt(r.unlockTime);
			const lockTime = toInt(r.lockTime);
			const unlocked = isTruthyBoolean(r.unlocked);

			// caster if sender is in owner wallets; otherwise supporter. If we don't know wallets, default to supporter until hydration is implemented.
			const isCaster = ownerWallets.has(sender);
			if (isCaster) {
				casterStakeLockupIds.push(lockUpId);
				casterStakeAmounts.push(amount);
				casterStakeUnlockTimes.push(unlockTime);
				casterStakeLockTimes.push(lockTime);
				casterStakeUnlocked.push(unlocked);
			} else {
				supporterStakeLockupIds.push(lockUpId);
				supporterStakeAmounts.push(amount);
				// Map sender to FID (0 if unknown)
				supporterStakeFids.push(senderFid);
				supporterStakeUnlockTimes.push(unlockTime);
				supporterStakeLockTimes.push(lockTime);
				supporterStakeUnlocked.push(unlocked);
			}
		}

		// Calculate cast_state based on actual caster stake data
		// This ensures casts are properly marked as 'higher', 'expired', or 'valid'
		const currentTime = Math.floor(Date.now() / 1000);
		let calculatedState: 'invalid' | 'valid' | 'higher' | 'expired' = 'valid';

		if (casterStakeLockupIds.length > 0) {
			// Check if there are any valid (not expired, not unlocked) caster stakes
			const hasValidCasterStake = casterStakeUnlockTimes.some((unlockTime, index) => {
				const unlocked = casterStakeUnlocked[index] || false;
				return !unlocked && unlockTime > currentTime;
			});

			if (hasValidCasterStake) {
				calculatedState = 'higher';
			} else {
				// All caster stakes are expired or unlocked
				calculatedState = 'expired';
			}
		} else {
			// No caster stakes yet - keep as 'valid' if cast exists, otherwise 'invalid'
			// If we have cast metadata, it's valid; otherwise invalid
			calculatedState = castMeta ? 'valid' : 'invalid';
		}

		const aggregated: AggregatedCast = {
			castHash,
			creatorFid: castMeta?.fid || ownerFid || 0,
			creatorUsername: castMeta?.username || '',
			creatorDisplayName: castMeta?.displayName,
			creatorPfpUrl: castMeta?.pfpUrl,
			castText: castMeta?.castText || '',
			description: castMeta?.description || '',
			castTimestamp: castMeta?.timestamp || new Date().toISOString(),
			totalHigherStaked,
			casterStakeLockupIds,
			casterStakeAmounts,
			casterStakeUnlockTimes,
			casterStakeLockTimes,
			casterStakeUnlocked,
			supporterStakeLockupIds,
			supporterStakeAmounts,
			supporterStakeFids,
			supporterStakeUnlockTimes,
			supporterStakeLockTimes,
			supporterStakeUnlocked,
			castState: calculatedState, // Use calculated state instead of castMeta?.state
		};

		result.set(castHash, aggregated);
	}

	return result;
}

export async function syncLockupsFromDune(): Promise<{ castsUpserted: number }> {
	const aggregated = await fetchAndAggregateLockupsFromDune();
	
	// Calculate ranks for casts with state 'higher' based on total_higher_staked
	// Only 'higher' casts get ranks; others get null
	const higherCasts = Array.from(aggregated.values())
		.filter(cast => cast.castState === 'higher')
		.sort((a, b) => b.totalHigherStaked - a.totalHigherStaked); // Sort DESC by total staked
	
	// Create a map of cast hash to rank
	const rankMap = new Map<string, number>();
	higherCasts.forEach((cast, index) => {
		rankMap.set(cast.castHash, index + 1); // Rank starts at 1
	});
	
	let upserts = 0;
	for (const [_hash, data] of aggregated) {
		// Get rank for this cast (only 'higher' casts have ranks)
		// Convert null to undefined to match the function signature (rank?: number)
		const rankValue = data.castState === 'higher' ? rankMap.get(data.castHash) : null;
		const rank = rankValue !== null ? rankValue : undefined;
		
		await upsertHigherCast({
			castHash: data.castHash,
			creatorFid: data.creatorFid,
			creatorUsername: data.creatorUsername,
			creatorDisplayName: data.creatorDisplayName,
			creatorPfpUrl: data.creatorPfpUrl,
			castText: data.castText,
			description: data.description,
			castTimestamp: data.castTimestamp,
			totalHigherStaked: data.totalHigherStaked,
			casterStakeLockupIds: data.casterStakeLockupIds,
			casterStakeAmounts: data.casterStakeAmounts,
			casterStakeUnlockTimes: data.casterStakeUnlockTimes,
			// new lock times to be supported in DB migration; will be ignored if column absent
			// @ts-ignore
			casterStakeLockTimes: data.casterStakeLockTimes,
			casterStakeUnlocked: data.casterStakeUnlocked,
			supporterStakeLockupIds: data.supporterStakeLockupIds,
			supporterStakeAmounts: data.supporterStakeAmounts,
			supporterStakeFids: data.supporterStakeFids,
			supporterStakeUnlockTimes: data.supporterStakeUnlockTimes,
			// @ts-ignore
			supporterStakeLockTimes: data.supporterStakeLockTimes,
			supporterStakeUnlocked: data.supporterStakeUnlocked,
			castState: data.castState,
			rank, // Include calculated rank (undefined for non-higher casts)
		});
		upserts += 1;
	}
	return { castsUpserted: upserts };
}

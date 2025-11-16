import { fetchAllLatestResults, DuneRow } from '../dune';
import { formatUnits } from 'viem';
import { upsertHigherCast, getHigherCast } from '../services/db-service';
import { getCastByHash } from '../services/cast-service';

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
	const cast = await getCastByHash(castHash); // may hit DB first, fallback to Neynar
	if (!cast) {
		return { ownerFid: null, ownerWallets: new Set() };
	}
	const ownerFid = cast.fid;
	// For now, assume the creator's wallets are not stored; hydrate via internal endpoint if available later.
	// As a minimal implementation, we treat only the creator's immediate onchain wallet unknown, so classification will default to supporter unless we enrich in DB later.
	// You can enhance this with a dedicated wallet lookup and cache.
	return { ownerFid, ownerWallets: new Set() };
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
		const castMeta = await getCastByHash(castHash); // for display fields if available

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
				// supporter FIDs unknown here; optional enrichment step could fill
				supporterStakeFids.push(0);
				supporterStakeUnlockTimes.push(unlockTime);
				supporterStakeLockTimes.push(lockTime);
				supporterStakeUnlocked.push(unlocked);
			}
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
			castState: castMeta?.state || 'valid',
		};

		result.set(castHash, aggregated);
	}

	return result;
}

export async function syncLockupsFromDune(): Promise<{ castsUpserted: number }> {
	const aggregated = await fetchAndAggregateLockupsFromDune();
	let upserts = 0;
	for (const [_hash, data] of aggregated) {
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
		});
		upserts += 1;
	}
	return { castsUpserted: upserts };
}

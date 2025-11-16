// Minimal Dune REST client for fetching latest query results with pagination
// Docs: https://docs.dune.com/api-reference/executions/endpoint/get-query-result

const DUNE_API_BASE = 'https://api.dune.com/api/v1';

export interface DuneRow {
	[key: string]: any;
}

export interface DuneResultsPage {
	rows: DuneRow[];
	next_offset?: number;
}

export interface FetchQueryOptions {
	columns?: string[]; // limit columns to reduce datapoints
	limit?: number; // rows per page
	startOffset?: number; // starting offset
	allowPartialResults?: boolean;
	filters?: string; // SQL-like filtering per Dune docs
	sort_by?: string; // SQL-like ORDER BY expression per Dune docs
}

function getApiKey(): string {
	const apiKey = process.env.DUNE_API_KEY;
	if (!apiKey) {
		throw new Error('DUNE_API_KEY is not set');
	}
	return apiKey;
}

async function fetchPage(queryId: number, opts: FetchQueryOptions = {}): Promise<{ page: DuneResultsPage; raw: any }> {
	const { columns, limit = 1000, startOffset = 0, allowPartialResults = false, filters, sort_by } = opts;
	const params = new URLSearchParams();
	params.set('limit', String(limit));
	params.set('offset', String(startOffset));
	if (columns && columns.length > 0) {
		params.set('columns', columns.join(','));
	}
	if (allowPartialResults) {
		params.set('allow_partial_results', 'true');
	}
	if (filters && filters.length > 0) {
		params.set('filters', filters);
	}
	if (sort_by && sort_by.length > 0) {
		params.set('sort_by', sort_by);
	}

	const res = await fetch(`${DUNE_API_BASE}/query/${queryId}/results?${params.toString()}`, {
		method: 'GET',
		headers: {
			'X-Dune-Api-Key': getApiKey(),
		},
		// avoid Next.js fetch caching for server runtime
		cache: 'no-store',
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Dune request failed (${res.status}): ${text}`);
	}
	const json = await res.json();
	const rows: DuneRow[] = json?.result?.rows ?? [];
	const next_offset: number | undefined = json?.next_offset;
	return { page: { rows, next_offset }, raw: json };
}

export async function fetchAllLatestResults(queryId: number, opts: FetchQueryOptions = {}): Promise<DuneRow[]> {
	const all: DuneRow[] = [];
	let offset = opts.startOffset ?? 0;
	const limit = opts.limit ?? 1000;
	// hard cap to avoid infinite loops
	const MAX_PAGES = 1000;
	let pages = 0;

	for (;;) {
		const { page } = await fetchPage(queryId, { ...opts, startOffset: offset, limit });
		if (!page.rows || page.rows.length === 0) break;
		all.push(...page.rows);
		pages += 1;
		if (pages >= MAX_PAGES) break;
		if (page.next_offset == null) {
			// If API does not return next_offset, compute via offset + limit
			offset += limit;
		} else {
			offset = page.next_offset;
		}
	}
	return all;
}

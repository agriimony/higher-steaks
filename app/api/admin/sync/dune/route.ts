import { NextRequest, NextResponse } from 'next/server';
import { syncLockupsFromDune } from '@/lib/indexers/lockupsFromDune';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorize(req: NextRequest): boolean {
	const token = req.headers.get('x-admin-token') || req.nextUrl.searchParams.get('token');
	const expected = process.env.ADMIN_SYNC_TOKEN;
	return !!expected && token === expected;
}

export async function POST(req: NextRequest) {
	try {
		if (!authorize(req)) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
		}

		const { castsUpserted } = await syncLockupsFromDune();
		return NextResponse.json({ ok: true, castsUpserted });
	} catch (error: any) {
		console.error('[admin/sync/dune] error', error);
		return NextResponse.json({ ok: false, error: error?.message || 'sync failed' }, { status: 500 });
	}
}

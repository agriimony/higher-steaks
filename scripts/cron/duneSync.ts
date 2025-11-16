#!/usr/bin/env ts-node
import 'dotenv/config';
import { syncLockupsFromDune } from '@/lib/indexers/lockupsFromDune';

(async () => {
	try {
		const res = await syncLockupsFromDune();
		console.log('[cron] dune sync completed', res);
		process.exit(0);
	} catch (err) {
		console.error('[cron] dune sync failed', err);
		process.exit(1);
	}
})();

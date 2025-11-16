import { describe, it, expect } from 'vitest';
import { fetchAndAggregateLockupsFromDune } from '../../indexers/lockupsFromDune';

// NOTE: This is a placeholder. In CI, you should mock fetchAllLatestResults and getCastByHash.

describe('lockupsFromDune transformer', () => {
	it('exists', () => {
		// sanity
		expect(typeof fetchAndAggregateLockupsFromDune).toBe('function');
	});
});

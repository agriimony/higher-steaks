import { describe, expect, it } from 'vitest';
import { buildInFilter } from './route';

describe('user stakes route helpers', () => {
  it('builds receiver IN filter with unlocked condition', () => {
    const filter = buildInFilter(['0xabc', '0xdef']);
    expect(filter).toBe(`(unlocked = false) AND (receiver IN ('0xabc','0xdef'))`);
  });
});



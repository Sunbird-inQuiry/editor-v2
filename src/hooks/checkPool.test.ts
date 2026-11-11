import { describe, it, expect, vi } from 'vitest';
import { checkPool } from './useRefreshQuestionSetBody';
import type { IFramework } from '../types/framework';

vi.mock('../api/content', () => ({
  questionBucketCounts: vi.fn(async () => ({ Physics: { E: 8, M: 0, D: 0 } })),
  questionSkillCounts: vi.fn(async () => ({ Physics: 8 })),
}));

const framework = { identifier: 'usf', name: 'USF', categories: [{ identifier: 'skill', code: 'skill', name: 'Skill', index: 1, terms: [] }] } as unknown as IFramework;

describe("checkPool (live counts against the set's own settings)", () => {
  it('accepts a pool the stored minCriteria/multiplier allow (positive)', async () => {
    expect(await checkPool(['Physics'], { E: 4, M: 0, D: 0 }, framework, 'ch', { minCriteria: 2, multiplier: 2 })).toEqual([]);
  });

  it('rejects the same pool under a larger stored multiplier (negative)', async () => {
    const problems = await checkPool(['Physics'], { E: 4, M: 0, D: 0 }, framework, 'ch', { minCriteria: 2, multiplier: 3 });
    expect(problems).toHaveLength(1);
  });
});

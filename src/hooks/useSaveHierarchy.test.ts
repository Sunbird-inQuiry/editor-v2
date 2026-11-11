import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildSavePayload } from './useSaveHierarchy';
import { queryClient } from '../queryClient';
import type { INode } from '../types/editor';

// Active framework BMGS's deepest category is `topic`; a cached USF makes `skill` a known code from another framework.
const root: INode = { id: 'do_root', identifier: 'do_root', name: 'Set', children: [] } as INode;
const rootMeta = (primaryCategory: string, cache: Record<string, unknown>) =>
  (buildSavePayload([root], { do_root: cache }, 'ch', primaryCategory).nodesModified.do_root as { metadata: Record<string, unknown> }).metadata;

describe('buildSavePayload taxonomy cleanup', () => {
  beforeEach(() => {
    queryClient.setQueryData(['framework', 'BMGS'], { identifier: 'BMGS', categories: [{ code: 'board', index: 1 }, { code: 'topic', index: 2 }] });
    queryClient.setQueryData(['framework', 'USF'], { identifier: 'USF', categories: [{ code: 'skill', index: 1 }] });
  });
  afterEach(() => queryClient.clear());

  it("keeps a Dynamic QuestionSet's selected skills, which live in the active framework's deepest category (positive)", () => {
    expect(rootMeta('Dynamic QuestionSet', { framework: 'BMGS', topic: ['Algebra'] }).topic).toEqual(['Algebra']);
  });

  it('clears a category from another framework the same way for Dynamic and other sets (negative)', () => {
    expect(rootMeta('Dynamic QuestionSet', { framework: 'BMGS', skill: ['Old'] }).skill).toEqual([]);
    expect(rootMeta('Practice Question Set', { framework: 'BMGS', skill: ['Old'] }).skill).toEqual([]);
  });
});

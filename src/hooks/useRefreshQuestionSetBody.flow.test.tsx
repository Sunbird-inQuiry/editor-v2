import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { INode } from '../types/editor';

const h = vi.hoisted(() => ({
  saveWithOutcome: vi.fn(),
  refreshQuestionSetBody: vi.fn(),
  readHierarchy: vi.fn(),
  notifyError: vi.fn(),
  editor: { editorConfig: { context: { identifier: 'do_qs', channel: 'ch1' }, config: {} }, contentFramework: null as string | null, setButtonLoader: vi.fn() },
  tree: { treeData: [] as INode[], treeCache: {} as Record<string, Record<string, unknown>>, setTreeData: vi.fn() },
}));

// Plain stores, since zustand returns its initial state under server rendering.
vi.mock('../store/editor.store', () => {
  const useEditorStore = Object.assign((sel: (s: typeof h.editor) => unknown) => sel(h.editor), { getState: () => h.editor });
  return { useEditorStore };
});
vi.mock('../store/tree.store', () => {
  const useTreeStore = Object.assign((sel: (s: typeof h.tree) => unknown) => sel(h.tree), { getState: () => h.tree });
  return { useTreeStore };
});
vi.mock('./useSaveHierarchy', () => ({ useSaveHierarchy: () => ({ saveWithOutcome: h.saveWithOutcome }) }));
vi.mock('./useValidateAndSave', () => ({ useValidateRequiredFields: () => () => true }));
vi.mock('../api/hierarchy', () => ({ refreshQuestionSetBody: h.refreshQuestionSetBody, readHierarchy: h.readHierarchy }));
vi.mock('../api/framework', () => ({ getFramework: vi.fn(async (id: string) => ({ identifier: id, categories: [{ code: 'skill', index: 1 }] })) }));
vi.mock('../api/content', () => ({
  questionBucketCounts: vi.fn(async () => ({ Physics: { E: 20, M: 20, D: 20 }, Chemistry: { E: 20, M: 20, D: 20 } })),
  questionSkillCounts: vi.fn(async () => ({ Physics: 60, Chemistry: 60 })),
}));
vi.mock('../utils/notify', () => ({ notifyError: h.notifyError, notifySuccess: vi.fn(), apiErrorMessage: (_e: unknown, f: string) => f }));

import { useRefreshQuestionSetBody } from './useRefreshQuestionSetBody';

const rootWith = (meta: Record<string, unknown>): INode => ({
  id: 'do_qs', identifier: 'do_qs', name: 'Set', primaryCategory: 'Dynamic QuestionSet', children: [],
  metadata: { framework: 'fw1', minCriteria: 2, multiplier: 2, ...meta },
} as INode);

function captureRefresh() {
  let refresh: ReturnType<typeof useRefreshQuestionSetBody>['refresh'] | undefined;
  function Probe() { refresh = useRefreshQuestionSetBody().refresh; return null; }
  renderToStaticMarkup(<Probe />);
  return refresh!;
}

describe('useRefreshQuestionSetBody: a Difficulty Target below the per-skill minimum', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.saveWithOutcome.mockResolvedValue('saved');
    h.readHierarchy.mockResolvedValue({ rootNode: rootWith({}) });
    // 2 skills x minCriteria 2 needs a total of 4; the target adds up to 2.
    h.tree.treeData = [rootWith({ skill: ['Physics', 'Chemistry'], difficultyTarget: '{"E":1,"M":1,"D":0}' })];
  });

  it('still saves the other edits on Save and says why nothing was generated (positive)', async () => {
    const ok = await captureRefresh()({ saveIfBlocked: true });
    expect(ok).toBe(false);
    expect(h.saveWithOutcome).toHaveBeenCalledTimes(1);
    expect(h.refreshQuestionSetBody).not.toHaveBeenCalled();
    expect(String(h.notifyError.mock.calls[0]?.[0])).toMatch(/^Saved, but the questions were not regenerated: Selected skills: 2\./);
  });

  it('saves nothing from Regenerate, which has no other edits to keep (negative)', async () => {
    await captureRefresh()();
    expect(h.saveWithOutcome).not.toHaveBeenCalled();
    expect(h.refreshQuestionSetBody).not.toHaveBeenCalled();
    expect(String(h.notifyError.mock.calls[0]?.[0])).toMatch(/^Selected skills: 2\./);
  });
});

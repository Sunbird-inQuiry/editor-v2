import { describe, it, expect, vi } from 'vitest';
import {
  saveThenGenerate, generateAndWait, poolProblems, deepestCategoryCode, skillShortfalls, skillPoolErrorMessage,
  startEditorSession, sessionCancelledCheck, shouldPauseAfterPending, belowSkillMinimum,
} from './useRefreshQuestionSetBody';
import type { INode } from '../types/editor';
import type { IFramework } from '../types/framework';

describe('poolProblems (mirrors the job, so whatever passes can be generated)', () => {
  const ten = { E: 10, M: 10, D: 10 };

  it('passes settings the job can generate (negative)', () => {
    expect(poolProblems(['Physics'], { E: 2, M: 2, D: 2 }, { Physics: ten }, { Physics: 30 })).toEqual([]);
  });

  it('reports a level the job cannot fill, counting each skill as floor(count / 2) (positive)', () => {
    // 3 + 4 Easy = 7 overall, but only 1 + 2 learners' worth can be drawn.
    const out = poolProblems(['A', 'B'], { E: 4, M: 0, D: 0 }, { A: { E: 3, M: 0, D: 0 }, B: { E: 4, M: 0, D: 0 } }, { A: 6, B: 6 });
    expect(out[0]).toContain('Easy: requested 4 needs 8, available 6');
  });

  it('reports too many skills for the target total (positive)', () => {
    expect(poolProblems(['A', 'B'], { E: 3, M: 0, D: 0 }, { A: ten, B: ten }, { A: 30, B: 30 })[0]).toContain('at least 4');
  });

  it('names the skill count without "1 skills" grammar (positive)', () => {
    const out = poolProblems(['A'], { E: 1, M: 0, D: 0 }, { A: ten }, { A: 30 })[0];
    expect(out).toContain('Selected skills: 1.');
    expect(out).not.toMatch(/With \d+ skills/);
  });

  it('reports missing inputs, never "0 skills ... at least 0", for no skills or a zero target (negative)', () => {
    expect(poolProblems([], { E: 2, M: 0, D: 0 }, {}, {})).toEqual(['Set Skill and Difficulty Target before generating questions.']);
    expect(poolProblems(['A'], { E: 0, M: 0, D: 0 }, { A: ten }, { A: 30 })[0]).not.toContain('at least 0');
  });

  it('reports a skill that would be left out of the pool at the chosen levels (positive)', () => {
    const out = poolProblems(['A', 'B'], { E: 4, M: 0, D: 0 }, { A: { E: 30, M: 0, D: 0 }, B: { E: 0, M: 0, D: 30 } }, { A: 30, B: 30 });
    expect(out[0]).toContain('B');
  });

  it('still applies the server per-skill floor of 4 (positive)', () => {
    expect(poolProblems(['A'], { E: 2, M: 0, D: 0 }, { A: { E: 6, M: 0, D: 0 } }, { A: 3 })[0]).toContain('at least 4');
  });
});

describe('belowSkillMinimum (checked before Save & Generate saves anything)', () => {
  it('rejects a total below minCriteria x skills, using the set\'s own minCriteria (positive)', () => {
    expect(belowSkillMinimum(1, { E: 1, M: 0, D: 0 }, { minCriteria: 2, multiplier: 2 })).toContain('at least 2');
    expect(belowSkillMinimum(2, { E: 2, M: 2, D: 1 }, { minCriteria: 3, multiplier: 2 })).toContain('at least 6');
  });

  it('accepts a total at or above the minimum (negative)', () => {
    expect(belowSkillMinimum(1, { E: 1, M: 1, D: 0 }, { minCriteria: 2, multiplier: 2 })).toBeNull();
    expect(belowSkillMinimum(2, { E: 2, M: 2, D: 0 }, { minCriteria: 2, multiplier: 2 })).toBeNull();
  });
});

describe('skillShortfalls', () => {
  it('lists each skill below minCriteria x multiplier (4) Live questions (positive)', () => {
    expect(skillShortfalls(['Physics', 'Azure'], { Physics: 30, Azure: 3 })).toEqual(['Azure']);
  });

  it('is empty when every skill has at least 4, and treats a missing count as 0 (negative)', () => {
    expect(skillShortfalls(['Physics'], { Physics: 4 })).toEqual([]);
    expect(skillShortfalls(['Unknown'], {})).toEqual(['Unknown']);
  });
});

describe("pool checks with the set's own minCriteria/multiplier", () => {
  const settings = { minCriteria: 4, multiplier: 2 };

  it('needs minCriteria x skills in the target and minCriteria x multiplier per skill (positive)', () => {
    const tooFew = poolProblems(['A', 'B'], { E: 7, M: 0, D: 0 }, { A: { E: 30, M: 0, D: 0 }, B: { E: 30, M: 0, D: 0 } }, { A: 30, B: 30 }, settings);
    expect(tooFew[0]).toContain('at least 8');
    expect(skillShortfalls(['A', 'B'], { A: 8, B: 7 }, settings)).toEqual(['B']);
    expect(poolProblems(['A'], { E: 4, M: 0, D: 0 }, { A: { E: 8, M: 0, D: 0 } }, { A: 7 }, settings)[0]).toContain('at least 8');
  });

  it('passes settings the stored values allow but the defaults would reject (negative)', () => {
    // E 4 x a stored multiplier 1 = 4 available; the default multiplier 2 would need 8.
    const single = { minCriteria: 2, multiplier: 1 };
    expect(poolProblems(['A'], { E: 4, M: 0, D: 0 }, { A: { E: 4, M: 0, D: 0 } }, { A: 4 }, single)).toEqual([]);
    expect(poolProblems(['A'], { E: 4, M: 0, D: 0 }, { A: { E: 4, M: 0, D: 0 } }, { A: 4 })).not.toEqual([]);
  });
});

describe('skillPoolErrorMessage', () => {
  const rejection = (err: string, message: string) => Object.assign(new Error(message), { response: { data: { params: { err } } } });

  it('translates the knowlg-service per-skill rejection (positive)', () => {
    expect(skillPoolErrorMessage(rejection('ERR_SKILL_INSUFFICIENT_POOL', 'Fewer than 6 Live questions found for skill(s): Azure, Scrum')))
      .toBe('Each skill needs at least 6 Live questions. Too few for: Azure, Scrum');
  });

  it('leaves other errors to the generic handler (negative)', () => {
    expect(skillPoolErrorMessage(rejection('ERR_OTHER', 'boom'))).toBeNull();
    expect(skillPoolErrorMessage(new Error('Network Error'))).toBeNull();
  });

  it('falls back to the server message, not blank placeholders, when the wording changes (negative)', () => {
    expect(skillPoolErrorMessage(rejection('ERR_SKILL_INSUFFICIENT_POOL', 'Pool too small for Azure'))).toBeNull();
  });
});

describe('deepestCategoryCode', () => {
  it('picks the highest-index category regardless of array order (positive)', () => {
    const fw = { categories: [{ code: 'topic', index: 3 }, { code: 'subject', index: 1 }] } as unknown as IFramework;
    expect(deepestCategoryCode(fw)).toBe('topic');
  });

  it('falls back to "skill" when the framework is not loaded (negative)', () => {
    expect(deepestCategoryCode(undefined)).toBe('skill');
  });
});

// Target E1: the job's finished write is exactly 2 Easy children (target x the default multiplier 2).
function root(childIds: string[], lastUpdatedOn = 't0'): { rootNode: INode } {
  return {
    rootNode: {
      id: 'do_root', identifier: 'do_root', name: 'tes123',
      children: childIds.map((id) => ({ id, identifier: id, name: id, isQuestion: true, metadata: { difficultyLevel: 'EASY' } })),
      metadata: { lastUpdatedOn, difficultyTarget: { E: 1, M: 0, D: 0 } },
    } as INode,
  };
}

const noSleep = () => Promise.resolve();

describe('saveThenGenerate (Dynamic Assess Generate Questions)', () => {
  it('saves before calling refresh-body, then reports generated once children appear (positive)', async () => {
    const calls: string[] = [];
    const save = vi.fn(async () => { calls.push('save'); return 'saved' as const; });
    const refresh = vi.fn(async () => { calls.push('refresh'); });
    const read = vi.fn()
      .mockResolvedValueOnce(root([]))            // baseline after save
      .mockResolvedValueOnce(root([]))            // job not done yet
      .mockResolvedValueOnce(root(['q1', 'q2'])); // job wrote children

    const out = await saveThenGenerate({ contentId: 'do_root', save, refresh, read, sleep: noSleep });

    expect(calls).toEqual(['save', 'refresh']);
    expect(out.result).toBe('generated');
    expect(out.rootNode?.children?.map((c) => c.identifier)).toEqual(['q1', 'q2']);
  });

  it('treats a lastUpdatedOn change as done even if the reselection kept the same ids (positive)', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(root(['q1', 'q2'], 't1'))
      .mockResolvedValueOnce(root(['q1', 'q2'], 't2'));
    const out = await saveThenGenerate({
      contentId: 'do_root', save: async () => 'saved', refresh: async () => {}, read, sleep: noSleep,
    });
    expect(out.result).toBe('generated');
  });

  it('does not generate when the save was not attempted, e.g. another save in flight (negative)', async () => {
    const refresh = vi.fn();
    const read = vi.fn();
    const out = await saveThenGenerate({
      contentId: 'do_root', save: async () => 'not-attempted', refresh, read, sleep: noSleep,
    });
    expect(out.result).toBe('failed');
    expect(refresh).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('does not call refresh-body when the save fails (negative)', async () => {
    const refresh = vi.fn();
    const read = vi.fn();
    const out = await saveThenGenerate({
      contentId: 'do_root', save: async () => 'failed', refresh, read, sleep: noSleep,
    });
    expect(out.result).toBe('failed');
    expect(refresh).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('reports pending, not generated, when nothing changes within the poll limit (negative)', async () => {
    const read = vi.fn().mockResolvedValue(root([]));
    const out = await saveThenGenerate({
      contentId: 'do_root', save: async () => 'saved', refresh: async () => {}, read,
      sleep: noSleep, maxAttempts: 3,
    });
    expect(out.result).toBe('pending');
    expect(read).toHaveBeenCalledTimes(4); // baseline + 3 polls
  });

  it('propagates a refresh-body rejection so the caller can show the backend message (negative)', async () => {
    const read = vi.fn().mockResolvedValue(root([]));
    await expect(saveThenGenerate({
      contentId: 'do_root', save: async () => 'saved',
      refresh: async () => { throw new Error('ERR_SKILL_INSUFFICIENT_POOL'); },
      read, sleep: noSleep,
    })).rejects.toThrow('ERR_SKILL_INSUFFICIENT_POOL');
  });

  it('keeps polling past the job /add until its /remove lands, so stale children are never kept (positive)', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(root(['o1', 'o2']))              // baseline: old pool
      .mockResolvedValueOnce(root(['o1', 'o2', 'n1', 'n2']))  // after /add, before /remove
      .mockResolvedValueOnce(root(['n1', 'n2'], 't1'));       // after /remove
    const out = await saveThenGenerate({ contentId: 'do_root', save: async () => 'saved', refresh: async () => {}, read, sleep: noSleep });
    expect(out.result).toBe('generated');
    expect(out.rootNode?.children?.map((c) => c.identifier)).toEqual(['n1', 'n2']);
  });
});

describe('generateAndWait (auto-generate on open)', () => {
  it('generates without saving and waits for the full write (positive)', async () => {
    const refresh = vi.fn(async () => {});
    const read = vi.fn().mockResolvedValueOnce(root([])).mockResolvedValueOnce(root(['q1', 'q2'], 't1'));
    const out = await generateAndWait({ contentId: 'do_root', refresh, read, sleep: noSleep }, root([]).rootNode);
    expect(refresh).toHaveBeenCalledWith('do_root');
    expect(out.result).toBe('generated');
  });
});

describe('generateAndWait robustness', () => {
  it('retries after a failed read instead of giving up mid-write (positive)', async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce(root(['q1', 'q2'], 't1'));
    const out = await generateAndWait({ contentId: 'do_root', refresh: async () => {}, read, sleep: noSleep }, root([]).rootNode);
    expect(out.result).toBe('generated');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reports pending, not a failure, when every read fails (negative)', async () => {
    const read = vi.fn().mockRejectedValue(new Error('Network Error'));
    const out = await generateAndWait({ contentId: 'do_root', refresh: async () => {}, read, sleep: noSleep, maxAttempts: 3 }, root([]).rootNode);
    expect(out.result).toBe('pending');
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('stops polling once cancelled, without returning a tree to write (positive)', async () => {
    let cancelled = false;
    const read = vi.fn(async () => { cancelled = true; return root(['q1', 'q2', 'q3'], 't1'); });
    const out = await generateAndWait({ contentId: 'do_root', refresh: async () => {}, read, sleep: noSleep, isCancelled: () => cancelled }, root([]).rootNode);
    expect(out).toEqual({ result: 'cancelled' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('does not call refresh-body when already cancelled (negative)', async () => {
    const refresh = vi.fn(async () => {});
    const out = await generateAndWait({ contentId: 'do_root', refresh, read: vi.fn(), sleep: noSleep, isCancelled: () => true }, root([]).rootNode);
    expect(out.result).toBe('cancelled');
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('editor sessions', () => {
  it('cancels a generation once another editor session starts (positive)', () => {
    const isCancelled = sessionCancelledCheck();
    expect(isCancelled()).toBe(false);
    startEditorSession();
    expect(isCancelled()).toBe(true);
  });

  it('leaves a generation from the current session running (negative)', () => {
    startEditorSession();
    expect(sessionCancelledCheck()()).toBe(false);
  });
});

describe('shouldPauseAfterPending', () => {
  it('pauses saving when the editor holds children a save could write back (positive)', () => {
    expect(shouldPauseAfterPending(root(['o1']).rootNode)).toBe(true);
  });

  it('does not lock an empty set, whose next save generates anyway (negative)', () => {
    expect(shouldPauseAfterPending(root([]).rootNode)).toBe(false);
    expect(shouldPauseAfterPending(undefined)).toBe(false);
  });
});

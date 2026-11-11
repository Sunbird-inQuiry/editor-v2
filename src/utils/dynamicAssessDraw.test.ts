import { describe, it, expect } from 'vitest';
import { isGenerationStale, isGenerationComplete, needsGeneration, selectedSkills, dynamicAssessSettings } from './dynamicAssessDraw';
import type { INode } from '../types/editor';

const q = (id: string, level: string): INode => ({ id, identifier: id, name: id, isQuestion: true, metadata: { difficultyLevel: level } });
const root = (children: INode[], target: unknown = { E: 1, M: 2, D: 0 }): INode => ({
  id: 'do_qs', identifier: 'do_qs', name: 'QS', primaryCategory: 'Dynamic QuestionSet', children, metadata: { difficultyTarget: target },
});
// Target E1 M2 D0 generated at the default multiplier 2 -> 2 Easy + 4 Medium children.
const pool = [...['e0', 'e1'].map((i) => q(i, 'EASY')), ...['m0', 'm1', 'm2', 'm3'].map((i) => q(i, 'MEDIUM'))];

describe('isGenerationComplete', () => {
  it('is complete only at exactly target x 2 per level (positive)', () => {
    expect(isGenerationComplete(root(pool))).toBe(true);
  });

  it('is not complete mid-write while old and new children are both attached, or when empty (negative)', () => {
    expect(isGenerationComplete(root([...pool, q('old1', 'EASY')]))).toBe(false);
    expect(isGenerationComplete(root([]))).toBe(false);
    expect(isGenerationComplete(undefined)).toBe(false);
  });
});

describe('isGenerationStale', () => {
  const sq = (id: string, level: string, skill: unknown = ['Physics']): INode => ({ ...q(id, level), metadata: { difficultyLevel: level, skill } });
  // Target E1 M2 D0 generated with multiplier 2 -> 2 Easy + 4 Medium children.
  const generated = () => [...['e0', 'e1'].map((i) => sq(i, 'EASY')), ...['m0', 'm1', 'm2', 'm3'].map((i) => sq(i, 'MEDIUM'))];
  const qs = (children: INode[], meta: Record<string, unknown> = {}): INode => ({
    ...root(children), metadata: { difficultyTarget: { E: 1, M: 2, D: 0 }, skill: ['Physics'], ...meta },
  });

  it('is not stale while settings match the generated children (negative)', () => {
    expect(isGenerationStale(qs(generated()), {})).toBe(false);
  });

  it('flags a target changed after generation, including unsaved form edits (positive)', () => {
    expect(isGenerationStale(qs(generated(), { difficultyTarget: { E: 1, M: 1, D: 0 } }), {})).toBe(true);
    expect(isGenerationStale(qs(generated()), { do_qs: { difficultyTarget: '{"E":2,"M":2,"D":0}' } })).toBe(true);
  });

  it('flags an added or swapped skill (positive)', () => {
    expect(isGenerationStale(qs(generated(), { skill: ['Physics', 'Chemistry'] }), {})).toBe(true);
    expect(isGenerationStale(qs(generated()), { do_qs: { skill: ['Chemistry'] } })).toBe(true);
  });

  it('skips the skill check when the pool children carry no skill (negative)', () => {
    const noSkill = generated().map((c) => ({ ...c, metadata: { difficultyLevel: c.metadata?.difficultyLevel } }));
    expect(isGenerationStale(qs(noSkill, { skill: ['Anything'] }), {})).toBe(false);
  });

  it('treats a section under a Dynamic root as needing regeneration, since generation only writes questions (positive)', () => {
    expect(isGenerationStale(qs([{ id: 's', identifier: 's', name: 's', isFolder: true }]), {})).toBe(true);
  });

  it('reads the selection and the questions\' skills from the framework\'s deepest category, e.g. topic (positive)', () => {
    const topicPool = generated().map((c) => ({ ...c, metadata: { difficultyLevel: c.metadata?.difficultyLevel, topic: ['Algebra'] } }));
    expect(isGenerationStale(qs(topicPool, { topic: ['Algebra'] }), {}, undefined, 'topic')).toBe(false);
    expect(isGenerationStale(qs(topicPool, { topic: ['Geometry'] }), {}, undefined, 'topic')).toBe(true);
  });

  it('ignores empty sets and non-Dynamic sets (negative)', () => {
    expect(isGenerationStale(qs([]), {})).toBe(false);
    expect(isGenerationStale({ ...qs(generated(), { difficultyTarget: { E: 9 } }), primaryCategory: 'Practice Question Set' }, {}, 'Practice Question Set')).toBe(false);
  });
});

describe('needsGeneration (Save also generates only when needed)', () => {
  const sq = (id: string, level: string): INode => ({ ...q(id, level), metadata: { difficultyLevel: level, skill: ['Physics'] } });
  const generated = () => [...['e0', 'e1'].map((i) => sq(i, 'EASY')), ...['m0', 'm1', 'm2', 'm3'].map((i) => sq(i, 'MEDIUM'))];
  const set = (children: INode[], meta: Record<string, unknown> = {}): INode => ({
    ...root(children), metadata: { difficultyTarget: { E: 1, M: 2, D: 0 }, skill: ['Physics'], ...meta },
  });

  it('generates on the first save that has Skill and Difficulty Target (positive)', () => {
    expect(needsGeneration(set([]), {})).toBe(true);
  });

  it('generates again when Skill or Target changed, including unsaved edits (positive)', () => {
    expect(needsGeneration(set(generated()), { do_qs: { difficultyTarget: { E: 2, M: 2, D: 0 } } })).toBe(true);
    expect(needsGeneration(set(generated()), { do_qs: { skill: ['Physics', 'Chemistry'] } })).toBe(true);
  });

  it('is a plain save for any other edit, e.g. a spelling fix in the name (negative)', () => {
    expect(needsGeneration(set(generated()), { do_qs: { name: 'Fixed typo' } })).toBe(false);
  });

  it('is a plain save while Skill or Target is incomplete, and for non-Dynamic sets (negative)', () => {
    expect(needsGeneration(set([], { skill: [] }), {})).toBe(false);
    expect(needsGeneration(set([], { difficultyTarget: { E: 0, M: 0, D: 0 } }), {})).toBe(false);
    expect(needsGeneration({ ...set([]), primaryCategory: 'Practice Question Set' }, {}, 'Practice Question Set')).toBe(false);
  });
});

describe('selectedSkills (the selection lives in the framework\'s deepest category field)', () => {
  it('reads that field, deduped, whether it holds a list or one value (positive)', () => {
    expect(selectedSkills({ topic: ['Algebra', 'Algebra', 'Geometry'], skill: ['Ignored'] }, 'topic')).toEqual(['Algebra', 'Geometry']);
    expect(selectedSkills({ topic: 'Algebra' }, 'topic')).toEqual(['Algebra']);
  });

  it('is empty when the field is missing or blank (negative)', () => {
    expect(selectedSkills({ skill: ['Physics'] }, 'topic')).toEqual([]);
    expect(selectedSkills({ topic: [] }, 'topic')).toEqual([]);
  });
});

describe('needsGeneration with a non-"skill" deepest category', () => {
  const dq = (id: string, level: string): INode => ({ id, identifier: id, name: id, isQuestion: true, metadata: { difficultyLevel: level, topic: ['Algebra'] } } as INode);
  const set = (children: INode[], meta: Record<string, unknown>): INode =>
    ({ id: 'do_root', identifier: 'do_root', name: 'Set', primaryCategory: 'Dynamic QuestionSet', children, metadata: { difficultyTarget: { E: 1, M: 0, D: 0 }, ...meta } } as INode);

  it('generates on the first save once topic holds the selection (positive)', () => {
    expect(needsGeneration(set([], { topic: ['Algebra'] }), {}, undefined, 'topic')).toBe(true);
  });

  it('does not treat a stray skill value as the selection when the framework\'s category is topic (negative)', () => {
    expect(needsGeneration(set([], { skill: ['Algebra'] }), {}, undefined, 'topic')).toBe(false);
    const generated = ['e0', 'e1'].map((i) => dq(i, 'EASY'));
    expect(needsGeneration(set(generated, { topic: ['Algebra'] }), {}, undefined, 'topic')).toBe(false);
  });
});

describe("dynamicAssessSettings (the set's own minCriteria/multiplier, like the job's nodeSetting)", () => {
  it('reads the stored values, as numbers or numeric strings (positive)', () => {
    expect(dynamicAssessSettings({ minCriteria: 4, multiplier: '5' })).toEqual({ minCriteria: 4, multiplier: 5 });
    expect(dynamicAssessSettings({ minCriteria: '0', multiplier: 2 })).toEqual({ minCriteria: 0, multiplier: 2 });
  });

  it('falls back to the defaults (2 and 2) when missing, blank, non-numeric or below the minimum (negative)', () => {
    expect(dynamicAssessSettings(undefined)).toEqual({ minCriteria: 2, multiplier: 2 });
    expect(dynamicAssessSettings({ minCriteria: '', multiplier: 'abc' })).toEqual({ minCriteria: 2, multiplier: 2 });
    expect(dynamicAssessSettings({ minCriteria: -1, multiplier: 0 })).toEqual({ minCriteria: 2, multiplier: 2 });
  });
});

describe("pool math uses the set's own multiplier", () => {
  const level = (prefix: string, lvl: string, n: number) => Array.from({ length: n }, (_, i) => q(`${prefix}${i}`, lvl));
  // Target E1 M2 D0 with multiplier 4 -> 4 Easy + 8 Medium children.
  const four = [...level('e', 'EASY', 4), ...level('m', 'MEDIUM', 8)];
  const withMultiplier = (children: INode[], multiplier: unknown): INode => ({ ...root(children), metadata: { difficultyTarget: { E: 1, M: 2, D: 0 }, multiplier } });

  it('is complete and not stale at target x 4 when the set stores multiplier 4 (positive)', () => {
    expect(isGenerationComplete(withMultiplier(four, 4))).toBe(true);
    expect(isGenerationStale(withMultiplier(four, 4), {})).toBe(false);
  });

  it('treats the same children as incomplete under the default multiplier, and stale when the set stores another (negative)', () => {
    expect(isGenerationComplete(withMultiplier(four, undefined))).toBe(false);
    expect(isGenerationStale(withMultiplier(four, 2), {})).toBe(true);
  });

  it('does not flag a set without its own multiplier whose pool fits one whole multiplier, e.g. an older x3 set (negative)', () => {
    const three = [...level('e', 'EASY', 3), ...level('m', 'MEDIUM', 6)];
    expect(isGenerationStale(withMultiplier(three, undefined), {})).toBe(false);
    expect(isGenerationStale(withMultiplier(four, undefined), {})).toBe(false);
  });

  it('still flags a set without its own multiplier when the target no longer fits its pool (positive)', () => {
    const three = [...level('e', 'EASY', 3), ...level('m', 'MEDIUM', 6)];
    expect(isGenerationStale({ ...withMultiplier(three, undefined), metadata: { difficultyTarget: { E: 1, M: 1, D: 0 } } }, {})).toBe(true);
    expect(isGenerationStale({ ...withMultiplier(three, undefined), metadata: { difficultyTarget: { E: 1, M: 2, D: 1 } } }, {})).toBe(true);
    expect(isGenerationStale({ ...withMultiplier(three, undefined), metadata: { difficultyTarget: { E: 2, M: 2, D: 0 } } }, {})).toBe(true);
  });
});

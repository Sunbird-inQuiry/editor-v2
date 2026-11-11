import { describe, it, expect } from 'vitest';
import { getUserId, getContentId, isDynamicAssessQuestionSet, resolvePrimaryCategory } from './context';
import type { IContext } from '../types/editor';

const base: IContext = {
  channel: 'ch',
  sid: 's',
  did: 'd',
  pdata: { id: 'p', ver: '1' },
};

describe('context normalization (old + new host contracts)', () => {
  it('prefers user.id (old portal contract) over userId/uid', () => {
    expect(getUserId({ ...base, user: { id: 'u-old' }, userId: 'u-flat', uid: 'u-uid' })).toBe('u-old');
  });

  it('falls back to userId, then uid', () => {
    expect(getUserId({ ...base, userId: 'u-flat', uid: 'u-uid' })).toBe('u-flat');
    expect(getUserId({ ...base, uid: 'u-uid' })).toBe('u-uid');
    expect(getUserId(base)).toBe('');
    expect(getUserId(undefined)).toBe('');
  });

  it('prefers identifier (old portal contract) over contentId', () => {
    expect(getContentId({ ...base, identifier: 'do_old', contentId: 'do_flat' })).toBe('do_old');
    expect(getContentId({ ...base, contentId: 'do_flat' })).toBe('do_flat');
    expect(getContentId(base)).toBe('');
    expect(getContentId(null)).toBe('');
  });
});

describe('isDynamicAssessQuestionSet', () => {
  it('matches only the exact Dynamic Assess primaryCategory', () => {
    expect(isDynamicAssessQuestionSet('Dynamic QuestionSet')).toBe(true);
  });

  it('does not match other categories, or nothing at all', () => {
    expect(isDynamicAssessQuestionSet('Practice Question Set')).toBe(false);
    expect(isDynamicAssessQuestionSet(undefined)).toBe(false);
    expect(isDynamicAssessQuestionSet(null)).toBe(false);
  });
});

describe('resolvePrimaryCategory', () => {
  it('uses the host config value when given, even if the root says otherwise (negative)', () => {
    expect(resolvePrimaryCategory('Practice Question Set', { primaryCategory: 'Dynamic QuestionSet' })).toBe('Practice Question Set');
  });

  it('falls back to the loaded root when the host omits it, so Dynamic guards stay on (positive)', () => {
    expect(resolvePrimaryCategory(undefined, { primaryCategory: 'Dynamic QuestionSet' })).toBe('Dynamic QuestionSet');
    expect(resolvePrimaryCategory(undefined, { metadata: { primaryCategory: 'Dynamic QuestionSet' } })).toBe('Dynamic QuestionSet');
  });

  it('is undefined with neither a config value nor a root (negative)', () => {
    expect(resolvePrimaryCategory(undefined, undefined)).toBeUndefined();
  });
});

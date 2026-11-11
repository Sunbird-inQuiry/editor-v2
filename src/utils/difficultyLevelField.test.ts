import { describe, it, expect } from 'vitest';
import { difficultyLevelField } from './difficultyLevelField';
import type { ICategoryField } from '../api/categoryDefinition';

const field = (over: Partial<ICategoryField>): ICategoryField => ({ code: 'difficultyLevel', label: 'Level', editable: true, visible: true, ...over } as ICategoryField);

describe('difficultyLevelField (the question Difficulty picker)', () => {
  it('follows a difficultyLevel field in the form config: hidden, read-only, or relabelled (positive)', () => {
    expect(difficultyLevelField([field({ visible: false })]).visible).toBe(false);
    expect(difficultyLevelField([field({ editable: false })]).editable).toBe(false);
    expect(difficultyLevelField([field({})])).toEqual({ visible: true, editable: true, label: 'Level' });
  });

  it('shows the picker as before when the config does not mention it (negative)', () => {
    expect(difficultyLevelField([{ code: 'name', label: 'Title', editable: true, visible: true } as ICategoryField])).toEqual({ visible: true, editable: true });
    expect(difficultyLevelField(null)).toEqual({ visible: true, editable: true });
  });
});

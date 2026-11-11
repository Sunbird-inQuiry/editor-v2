import { describe, it, expect, beforeEach } from 'vitest';
import { buildLiveQuestionMeta } from './useSaveQuestion';
import { useQuestionStore, normalizeDifficultyLevel } from '../store/question.store';
import { useTreeStore } from '../store/tree.store';
import { useEditorStore } from '../store/editor.store';
import type { IQuestion } from '../types/question';

// A minimal MCQ the editor could save: one option, marked correct, under a selected question node.
function setUpQuestion(difficultyLevel: string) {
  useQuestionStore.setState({
    questionType: 'mcq',
    questionBody: '<p>What is 2 + 2?</p>',
    options: [{ id: 'o1', body: '4', isCorrect: true }],
    difficultyLevel,
  });
  useTreeStore.setState({ selectedNodeId: 'temp-q1', treeData: [], treeCache: {}, activeNodeMeta: {} });
  useEditorStore.setState({
    editorConfig: { context: { channel: 'ch1', host: 'https://example.test', user: { id: 'u1' } } } as never,
  });
}

describe('question difficulty in the save payload (Dynamic Assess pool)', () => {
  beforeEach(() => useQuestionStore.getState().resetQuestion());

  it('sends the picked difficulty as the pool stores it (positive)', () => {
    setUpQuestion('EASY');
    expect(buildLiveQuestionMeta()?.questionMeta.difficultyLevel).toBe('EASY');
  });

  it('sends no difficulty when none was picked, so other questions save as before (negative)', () => {
    setUpQuestion('');
    expect(buildLiveQuestionMeta()?.questionMeta).not.toHaveProperty('difficultyLevel');
  });

  it('sends null to remove a difficulty the question was loaded with and the author cleared (positive)', () => {
    setUpQuestion('');
    useQuestionStore.setState({ activeQuestion: { identifier: 'do_q1', name: 'q', difficultyLevel: 'DIFFICULT' } as IQuestion });
    expect(buildLiveQuestionMeta()?.questionMeta.difficultyLevel).toBeNull();
  });

  it('uses the last save in this session: cleared after picking one sends null, cleared twice sends nothing (positive/negative)', () => {
    setUpQuestion('');
    useQuestionStore.setState({ activeQuestion: { identifier: 'do_q1', name: 'q' } as IQuestion });
    useTreeStore.setState({ treeCache: { 'temp-q1': { difficultyLevel: 'EASY' } } });
    expect(buildLiveQuestionMeta()?.questionMeta.difficultyLevel).toBeNull();
    useTreeStore.setState({ treeCache: { 'temp-q1': { difficultyLevel: null } } });
    expect(buildLiveQuestionMeta()?.questionMeta).not.toHaveProperty('difficultyLevel');
  });
});

describe('normalizeDifficultyLevel / loading a question', () => {
  it('maps legacy and lower-case values to EASY/MEDIUM/DIFFICULT', () => {
    expect(normalizeDifficultyLevel('hard')).toBe('DIFFICULT');
    expect(normalizeDifficultyLevel('easy')).toBe('EASY');
    expect(normalizeDifficultyLevel('MEDIUM')).toBe('MEDIUM');
  });

  it('leaves unknown or missing values unset (negative)', () => {
    expect(normalizeDifficultyLevel(undefined)).toBe('');
    expect(normalizeDifficultyLevel('expert')).toBe('');
  });

  it('loads a legacy "hard" question as DIFFICULT and an untagged one as unset', () => {
    useQuestionStore.getState().setActiveQuestion({ identifier: 'do_1', name: 'q', difficultyLevel: 'hard' } as IQuestion);
    expect(useQuestionStore.getState().difficultyLevel).toBe('DIFFICULT');
    useQuestionStore.getState().setActiveQuestion({ identifier: 'do_2', name: 'q' } as IQuestion);
    expect(useQuestionStore.getState().difficultyLevel).toBe('');
  });
});

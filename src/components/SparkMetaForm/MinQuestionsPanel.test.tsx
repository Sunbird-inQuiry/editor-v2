import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { MinQuestionsPanel, exampleLines } from './MinQuestionsPanel';
import SparkMetaForm from './SparkMetaForm';
import type { ICategoryField } from '../../api/categoryDefinition';

// The stores return their initial state under server rendering, so the category is switched through the hook.
const category = vi.hoisted(() => ({ dynamic: false }));
vi.mock('../../hooks/useIsDynamicAssess', () => ({ useIsDynamicAssess: () => category.dynamic }));
// Pool searches, which the panel must never call.
const counts = vi.hoisted(() => ({ bucket: vi.fn(), skill: vi.fn() }));
vi.mock('../../api/content', () => ({ questionBucketCounts: counts.bucket, questionSkillCounts: counts.skill }));

const render = (node: React.ReactElement) =>
  renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);

describe('MinQuestionsPanel', () => {
  it("shows the set's minimum per skill and flags a total below it (positive)", () => {
    const html = render(<MinQuestionsPanel values={{ skill: ['A', 'B'], minCriteria: 4 }} target={{ E: 1, M: 1, D: 1 }} />);
    expect(html).toContain('Minimum questions per skill');
    expect(html).toContain('increase the total to at least 8');
    expect(html).toContain('Total: 3 · Minimum: 8');
    expect(html).toContain('Needs adjustment');
  });

  it('drops the badge once the total meets the minimum, defaulting minCriteria to 2 (negative)', () => {
    const html = render(<MinQuestionsPanel values={{ skill: ['A'] }} target={{ E: 1, M: 1, D: 0 }} />);
    expect(html).toContain('Each selected skill needs at least 2 questions.');
    expect(html).toContain('Total: 2 · Minimum: 2');
    expect(html).not.toContain('Needs adjustment');
  });

  it('renders nothing until a skill is selected (negative)', () => {
    expect(render(<MinQuestionsPanel values={{ minCriteria: 4 }} target={{ E: 1, M: 0, D: 0 }} />)).toBe('');
  });

  it('offers "See an example" but keeps the example hidden until it is opened, and never searches (negative)', () => {
    counts.bucket.mockClear();
    counts.skill.mockClear();
    const html = render(<MinQuestionsPanel values={{ skill: ['Physics'] }} target={{ E: 2, M: 2, D: 2 }} />);
    expect(html).toContain('See an example');
    expect(html).not.toContain('dynamic-assess-example');
    expect(html).not.toContain('Each learner gets');
    expect(counts.bucket).not.toHaveBeenCalled();
    expect(counts.skill).not.toHaveBeenCalled();
  });
});

describe('exampleLines (fixed example)', () => {
  const L = (_key: string, fallback: string) => fallback;

  it("uses 2 skills and the set's minCriteria of 2 (positive)", () => {
    expect(exampleLines(2, L)).toEqual({
      intro: 'Example: you pick 2 skills and ask for 2 Easy, 2 Medium and 2 Difficult.',
      points: ['Each learner gets 6 questions.', 'Minimum 2 questions will come from each skill.'],
    });
  });

  it('follows a different minCriteria, e.g. 3 (positive)', () => {
    expect(exampleLines(3, L)).toEqual({
      intro: 'Example: you pick 2 skills and ask for 3 Easy, 3 Medium and 3 Difficult.',
      points: ['Each learner gets 9 questions.', 'Minimum 3 questions will come from each skill.'],
    });
  });

  it("doesn't depend on the creator's skills or target (negative)", () => {
    // Only minCriteria goes in, so nothing the creator types can change it; the same call always gives the same text.
    expect(exampleLines.length).toBe(2);
    expect(exampleLines(2, L)).toEqual(exampleLines(2, L));
  });

  it('never asks for 0 per level, even with a minCriteria of 0 (negative)', () => {
    expect(exampleLines(0, L).intro).toContain('1 Easy, 1 Medium and 1 Difficult');
  });
});

describe('SparkMetaForm difficultyTarget', () => {
  const fields = [{ code: 'difficultyTarget', label: 'Difficulty Target', visible: true, editable: true, section: 'Behaviour' }] as ICategoryField[];
  const values = { skill: ['A', 'B'], minCriteria: 4, difficultyTarget: '{"E":1,"M":1,"D":1}' };
  const form = (isRoot: boolean) => render(<SparkMetaForm fields={fields} values={values} onChange={() => {}} section="Behaviour" isRoot={isRoot} />);

  it("shows the panel under a Dynamic set root's target (positive)", () => {
    category.dynamic = true;
    expect(form(true)).toContain('Needs adjustment');
  });

  it('shows no panel for other question sets or below the root (negative)', () => {
    category.dynamic = false;
    expect(form(true)).not.toContain('Minimum questions per skill');
    category.dynamic = true;
    expect(form(false)).not.toContain('Minimum questions per skill');
  });
});

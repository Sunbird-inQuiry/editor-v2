import { useState } from 'react';
import { useLabels } from '../../hooks/useLabels';
import { useDynamicSkillField } from '../../hooks/useDynamicSkillField';
import { dynamicAssessSettings, selectedSkills } from '../../utils/dynamicAssessDraw';
import type { DifficultyTarget } from '../../utils/difficultyTarget';
import styles from './SparkMetaForm.module.scss';

type Label = (key: string, fallback: string) => string;

const fill = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((t, [k, v]) => t.split(`{${k}}`).join(String(v)), text);

/** The fixed example under "See an example": 2 skills and the set's own minCriteria per level, independent of what the creator entered. */
export function exampleLines(minCriteria: number, L: Label): { intro: string; points: string[] } {
  const n = Math.max(minCriteria, 1);
  return {
    intro: fill(L('ui.dynamicAssessExampleIntro', 'Example: you pick 2 skills and ask for {N} Easy, {N} Medium and {N} Difficult.'), { N: n }),
    points: [
      fill(L('ui.dynamicAssessExampleTotal', 'Each learner gets {TOTAL} questions.'), { TOTAL: n * 3 }),
      fill(L('ui.dynamicAssessExampleEach', 'Minimum {MIN} questions will come from each skill.'), { MIN: minCriteria }),
    ],
  };
}

/** Dynamic Assess: the set's own per-skill minimum against the live Difficulty Target, once a skill is selected; Save is still blocked by the pool check. */
export function MinQuestionsPanel({ values, target }: { values: Record<string, unknown>; target: DifficultyTarget }) {
  const L = useLabels();
  const skillField = useDynamicSkillField();
  const [expanded, setExpanded] = useState(false);

  const skills = selectedSkills(values, skillField);
  if (!skills.length) return null;

  const { minCriteria } = dynamicAssessSettings(values);
  const total = (target.E ?? 0) + (target.M ?? 0) + (target.D ?? 0);
  const minimum = minCriteria * skills.length;
  const short = total < minimum;
  const example = exampleLines(minCriteria, L);

  return (
    <div
      role="status"
      data-testid="dynamic-assess-min-panel"
      className={short ? `${styles.minPanel} ${styles.minPanelShort}` : styles.minPanel}
    >
      <div className={styles.minPanelTitle}>{L('ui.dynamicAssessMinTitle', 'Minimum questions per skill')}</div>
      <p className={styles.minPanelText}>
        {short
          ? fill(L('ui.dynamicAssessMinNeeds', 'Each selected skill needs at least {MIN} questions; increase the total to at least {MINIMUM}.'), { MIN: minCriteria, MINIMUM: minimum })
          : fill(L('ui.dynamicAssessMinOk', 'Each selected skill needs at least {MIN} questions.'), { MIN: minCriteria })}
      </p>
      <div className={styles.minPanelFooter}>
        <span>{fill(L('ui.dynamicAssessMinFooter', 'Total: {TOTAL} · Minimum: {MINIMUM}'), { TOTAL: total, MINIMUM: minimum })}</span>
        <span className={styles.minPanelActions}>
          {short && (
            <span className={styles.minPanelBadge}>
              {L('ui.dynamicAssessNeedsAdjustment', 'Needs adjustment')}
            </span>
          )}
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className={styles.minPanelToggle}
          >
            {expanded ? `${L('ui.dynamicAssessExampleHide', 'Hide')} ▴` : `${L('ui.dynamicAssessExampleShow', 'See an example')} ▾`}
          </button>
        </span>
      </div>
      {expanded && (
        <div data-testid="dynamic-assess-example" className={styles.minPanelExample}>
          <p className={styles.minPanelExampleIntro}>{example.intro}</p>
          <ul className={styles.minPanelExampleList}>
            {example.points.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

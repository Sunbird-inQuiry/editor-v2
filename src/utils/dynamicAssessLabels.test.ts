import { describe, it, expect, afterEach } from 'vitest';
import en from '../locales/label.config.json';
import ar from '../locales/label.config.ar.json';
import fr from '../locales/label.config.fr.json';
import hi from '../locales/label.config.hi.json';
import pt from '../locales/label.config.pt.json';
import { setUiLanguage } from './labels';
import { poolProblems } from '../hooks/useRefreshQuestionSetBody';

type Section = Record<string, unknown>;
const pick = (cfg: Section, path: string) => path.split('.').reduce<unknown>((o, k) => (o as Section | undefined)?.[k], cfg);

const DA_PATHS = Object.entries({
  ui: (en as Section).ui as Section,
  'messages.error': ((en as Section).messages as Section).error as Section,
  'messages.success': ((en as Section).messages as Section).success as Section,
  'messages.info': ((en as Section).messages as Section).info as Section,
}).flatMap(([section, entries]) => Object.keys(entries)
  .filter((k) => /dynamicAssess|generat|^difficulty/i.test(k))
  .map((k) => `${section}.${k}`));

describe('Dynamic Assess labels', () => {
  afterEach(() => { setUiLanguage('en'); });

  it('are translated in every UI language instead of falling back to English (positive)', () => {
    expect(DA_PATHS.length).toBeGreaterThan(10);
    for (const [lang, cfg] of Object.entries({ ar, fr, hi, pt })) {
      for (const path of DA_PATHS) expect(pick(cfg as Section, path), `${lang}.${path}`).toBeTruthy();
    }
  });

  it('localise the pool shortfall message with every placeholder filled (positive)', () => {
    setUiLanguage('fr');
    expect(poolProblems(['A'], { E: 2, M: 0, D: 0 }, { A: { E: 1, M: 0, D: 0 } }, { A: 6 })[0])
      .toContain('Facile : 2 demandées, 4 nécessaires, 0 disponibles');
  });
});

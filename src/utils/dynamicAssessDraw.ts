import type { INode } from '../types/editor';
import { toDifficultyTarget } from './difficultyTarget';

// Dynamic Assess pool settings and generation checks; the editor shows the whole pool, and learners get their own draw in the portal.

const LEVELS = [['E', 'EASY'], ['M', 'MEDIUM'], ['D', 'DIFFICULT']] as const;

/** Dynamic Assess: default pool multiplier (requested x this many Live questions per difficulty) for a set without its own; matches the backend's dynamicassess.multiplier default. */
export const DYNAMIC_ASSESS_POOL_MULTIPLIER = 2;

/** Dynamic Assess: default minimum questions per selected skill for a set without its own; matches the backend's dynamicassess.minCriteria default. */
export const DYNAMIC_ASSESS_MIN_CRITERIA = 2;

export interface DynamicAssessSettings { minCriteria: number; multiplier: number }

/** The set's own minCriteria/multiplier (stored at create by knowlg-service), else the defaults for sets created before it was, or holding a value below the minimum; mirrors the job's nodeSetting. */
export function dynamicAssessSettings(meta: Record<string, unknown> | undefined): DynamicAssessSettings {
  return {
    minCriteria: readSetting(meta?.minCriteria, 0) ?? DYNAMIC_ASSESS_MIN_CRITERIA,
    multiplier: readSetting(meta?.multiplier, 1) ?? DYNAMIC_ASSESS_POOL_MULTIPLIER,
  };
}

/** A stored setting as an integer, or undefined when it's missing or below `min`. */
function readSetting(v: unknown, min: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && Math.trunc(n) >= min ? Math.trunc(n) : undefined;
}

const levelOf = (c: INode, treeCache: Record<string, Record<string, unknown>>) =>
  String(c.metadata?.difficultyLevel ?? treeCache[c.identifier]?.difficultyLevel ?? '').toUpperCase();

/** The selected skills: the terms in the framework's deepest category field (`skillField`, e.g. "topic"), the same field the backend reads them from. */
export function selectedSkills(meta: Record<string, unknown>, skillField: string): string[] {
  const v = meta[skillField];
  return [...new Set((Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean))];
}

/** True when the root's current skill/difficultyTarget no longer match its generated children: the job publishes exactly target x multiplier per level and tags each child with its skill. */
export function isGenerationStale(
  root: INode | undefined, treeCache: Record<string, Record<string, unknown>>, primaryCategory?: string, skillField = 'skill',
): boolean {
  if (!root) return false;
  const meta = { ...(root.metadata ?? {}), ...(treeCache[root.identifier] ?? {}) } as Record<string, unknown>;
  if ((primaryCategory ?? root.primaryCategory ?? meta.primaryCategory) !== 'Dynamic QuestionSet') return false;
  const children = root.children ?? [];
  if (children.length === 0) return false;
  // Generation only ever writes questions, so anything else under a Dynamic root means it needs regenerating.
  if (children.some((c) => !c.isQuestion)) return true;
  const field = (c: INode, key: string) => c.metadata?.[key] ?? treeCache[c.identifier]?.[key];
  const target = toDifficultyTarget(meta.difficultyTarget);
  const levels = LEVELS.map(([key, level]) => ({
    want: target[key] ?? 0,
    count: children.filter((c) => String(field(c, 'difficultyLevel') ?? '').toUpperCase() === level).length,
  }));
  const ownMultiplier = readSetting(meta.multiplier, 1);
  if (ownMultiplier !== undefined) {
    if (levels.some(({ want, count }) => count !== want * ownMultiplier)) return true;
  } else {
    // Sets from before the multiplier was stored were generated at another one, so only counts that fit no single whole multiplier are stale.
    if (levels.some(({ want, count }) => (want <= 0) !== (count === 0))) return true;
    const ratios = new Set(levels.filter(({ want }) => want > 0).map(({ want, count }) => count / want));
    if (ratios.size > 1 || [...ratios].some((r) => !Number.isInteger(r))) return true;
  }
  const saved = new Set(selectedSkills(meta, skillField));
  // The root's selection and the pool questions' tags both live in the framework's deepest category (e.g. "topic").
  const skillsOf = (c: INode) => { const v = field(c, skillField); return (Array.isArray(v) ? v : v ? [v] : []).map(String); };
  // Children with no value in that field (e.g. the framework hasn't loaded, so the field is unknown) leave only the target to check.
  if (!children.some((c) => skillsOf(c).length)) return false;
  const covered = new Set(children.flatMap(skillsOf).filter((s) => saved.has(s)));
  return covered.size !== saved.size || children.some((c) => !skillsOf(c).some((s) => saved.has(s)));
}

/** True once the job has fully written the pool for the root's saved target: exactly target x the set's multiplier questions per level, after both its /add and /remove. */
export function isGenerationComplete(root: INode | undefined): boolean {
  if (!root) return false;
  const children = root.children ?? [];
  if (children.length === 0 || children.some((c) => !c.isQuestion)) return false;
  const target = toDifficultyTarget(root.metadata?.difficultyTarget);
  const { multiplier } = dynamicAssessSettings(root.metadata);
  return LEVELS.every(([key, level]) =>
    children.filter((c) => levelOf(c, {}) === level).length === (target[key] ?? 0) * multiplier);
}

/** Save must also generate when the set has usable Skill + Difficulty Target and either no questions yet or questions built for other settings; any other save is a plain save. */
export function needsGeneration(
  root: INode | undefined, treeCache: Record<string, Record<string, unknown>>, primaryCategory?: string, skillField = 'skill',
): boolean {
  if (!root) return false;
  const meta = { ...(root.metadata ?? {}), ...(treeCache[root.identifier] ?? {}) } as Record<string, unknown>;
  if ((primaryCategory ?? root.primaryCategory ?? meta.primaryCategory) !== 'Dynamic QuestionSet') return false;
  const target = toDifficultyTarget(meta.difficultyTarget);
  const hasInputs = selectedSkills(meta, skillField).length > 0 && (target.E ?? 0) + (target.M ?? 0) + (target.D ?? 0) > 0;
  if (!hasInputs) return false;
  return !(root.children ?? []).some((c) => c.isQuestion) || isGenerationStale(root, treeCache, primaryCategory, skillField);
}

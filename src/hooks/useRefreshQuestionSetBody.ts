import { useCallback } from 'react';
import { notifySuccess, notifyError, apiErrorMessage } from '../utils/notify';
import { useEditorStore } from '../store/editor.store';
import { useTreeStore } from '../store/tree.store';
import { refreshQuestionSetBody, readHierarchy } from '../api/hierarchy';
import { questionBucketCounts, questionSkillCounts } from '../api/content';
import { getContentId } from '../utils/context';
import { label } from '../utils/labels';
import { useSaveHierarchy, type SaveOutcome } from './useSaveHierarchy';
import { toDifficultyTarget, type DifficultyTarget } from '../utils/difficultyTarget';
import { planPool } from '../utils/poolPlan';
import { useValidateRequiredFields } from './useValidateAndSave';
import { highestIndexCategoryCode, resolveFrameworkId } from './useFramework';
import { getFramework } from '../api/framework';
import { dynamicAssessSettings, isGenerationComplete, selectedSkills, type DynamicAssessSettings } from '../utils/dynamicAssessDraw';
import { queryClient } from '../queryClient';
import type { INode } from '../types/editor';
import type { IFramework } from '../types/framework';

type Buckets = Record<string, Record<'E' | 'M' | 'D', number>>;

/** Why the job couldn't generate these settings (it mirrors the job's own allocation, with the set's own minCriteria/multiplier), plus knowlg-service's per-skill floor; empty when generation can go ahead. */
export function poolProblems(
  skills: string[], target: DifficultyTarget, buckets: Buckets, skillTotals: Record<string, number>, settings: DynamicAssessSettings = dynamicAssessSettings(undefined),
): string[] {
  const m = settings.multiplier;
  const min = settings.minCriteria;
  const plan = planPool(skills, target, (s, l) => buckets[s]?.[l] ?? 0, min, m);
  if (plan.noInputs) return [inputsMessage()];
  if (plan.infeasible) return [tooManySkillsMessage(skills.length, min)];
  if (plan.uncovered.length) {
    const name = { E: label('ui.difficultyEasy', 'Easy'), M: label('ui.difficultyMedium', 'Medium'), D: label('ui.difficultyDifficult', 'Difficult') };
    const template = label('messages.error.dynamicAssessShortfall', '{LEVEL}: requested {REQUESTED} needs {NEEDED}, available {AVAILABLE}');
    const lines = plan.uncovered.map(({ level, covered, target: requested }) => template
      .replace('{LEVEL}', name[level]).replace('{REQUESTED}', String(requested))
      .replace('{NEEDED}', String(requested * m)).replace('{AVAILABLE}', String(covered * m)));
    return [`${label('messages.error.dynamicAssessPool', 'Not enough questions available for the selected skill(s)')}: ${lines.join('; ')}`];
  }
  // A skill left without its own minimum would be missing from the pool, and the settings would then never match the questions.
  if (plan.shortSkills.length) {
    return [label('messages.error.dynamicAssessSkillLevels', 'Not enough questions at the selected difficulty levels for: {SKILLS}. Each skill needs at least {MIN} questions it can supply at those levels.')
      .replace('{SKILLS}', plan.shortSkills.join(', ')).replace('{MIN}', String(min))];
  }
  const shortSkills = skillShortfalls(skills, skillTotals, settings);
  return shortSkills.length ? [skillPoolMessage(min * m, shortSkills)] : [];
}

function inputsMessage(): string {
  return label('messages.error.dynamicAssessInputs', 'Set Skill and Difficulty Target before generating questions.');
}

function tooManySkillsMessage(count: number, min: number): string {
  return label('messages.error.dynamicAssessTooManySkills', 'Selected skills: {COUNT}. The Difficulty Target must add up to at least {NEEDED} (each skill gets at least {MIN} questions). Raise the target or remove a skill.')
    .replace('{COUNT}', String(count)).replace('{NEEDED}', String(count * min)).replace('{MIN}', String(min));
}

/** The minimum-questions panel's rule (each selected skill gets at least minCriteria), checked without a search; the message when the target is below it, else null. */
export function belowSkillMinimum(skillCount: number, target: DifficultyTarget, settings: DynamicAssessSettings): string | null {
  const total = (target.E ?? 0) + (target.M ?? 0) + (target.D ?? 0);
  return skillCount * settings.minCriteria > total ? tooManySkillsMessage(skillCount, settings.minCriteria) : null;
}

/** Skills below the minCriteria x multiplier Live questions knowlg-service requires before it accepts a refresh. */
export function skillShortfalls(skills: string[], counts: Record<string, number>, settings: DynamicAssessSettings = dynamicAssessSettings(undefined)): string[] {
  return skills.filter((s) => (counts[s] ?? 0) < settings.minCriteria * settings.multiplier);
}

function skillPoolMessage(needed: number | string, skills: string[]): string {
  return label('messages.error.dynamicAssessSkillPool', 'Each skill needs at least {NEEDED} Live questions. Too few for: {SKILLS}')
    .replace('{NEEDED}', String(needed))
    .replace('{SKILLS}', skills.join(', '));
}

/** Translates knowlg-service's per-skill rejection, whose message is English-only ("Fewer than 6 Live questions found for skill(s): A, B"). */
export function skillPoolErrorMessage(err: unknown): string | null {
  const response = (err as { response?: { data?: { params?: { err?: string } } } })?.response;
  if (response?.data?.params?.err !== 'ERR_SKILL_INSUFFICIENT_POOL') return null;
  const match = /Fewer than (\d+).*skill\(s\):\s*(.+)$/.exec(err instanceof Error ? err.message : '');
  // Reworded server text falls back to the server's own message rather than a template with blanks.
  if (!match) return null;
  return skillPoolMessage(match[1], match[2].split(',').map((s) => s.trim()));
}

/** The field the job's pool query filters on: the framework's highest-index category, else "skill". */
export function deepestCategoryCode(framework: IFramework | undefined): string {
  return highestIndexCategoryCode(framework?.categories ?? []) ?? 'skill';
}

export const GENERATE_POLL_MS = 3000;
export const GENERATE_POLL_MAX_ATTEMPTS = 40;

export type GenerateResult = 'generated' | 'pending' | 'failed' | 'cancelled';

export interface GenerateDeps {
  contentId: string;
  save: () => Promise<SaveOutcome>;
  refresh: (contentId: string) => Promise<void>;
  read: (contentId: string) => Promise<{ rootNode: INode }>;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  maxAttempts?: number;
  /** True once the editor that started this generation has closed or reloaded; the wait then stops without touching the shared stores. */
  isCancelled?: () => boolean;
}

let editorSession = 0;

/** Bumped whenever an editor opens or closes; the stores are shared, so a generation from an earlier session must not write into the current one. */
export function startEditorSession(): void {
  editorSession += 1;
}

/** Cancellation check for a generation started now: true once another session has begun. */
export function sessionCancelledCheck(): () => boolean {
  const session = editorSession;
  return () => editorSession !== session;
}

export function generationPendingMessage(): string {
  return label('messages.error.dynamicAssessPending', 'Questions haven\'t appeared yet. Generation may still be running, or it may have failed (for example, too few questions for a skill). Reopen this question set in a moment, or check the pool and try again.');
}

/** Whether a timed-out generation must pause saving, given the tree the editor would save: only children it could write back over the job's result need it. */
export function shouldPauseAfterPending(editorRoot: INode | undefined): boolean {
  // An empty set has nothing to write back, and its next save is a generating one, so pausing would only lock the author out.
  return (editorRoot?.children?.length ?? 0) > 0;
}

/** The framework through the shared query cache (same key and staleTime as useFramework), fetched if not loaded yet; undefined without an id. */
export async function fetchFramework(frameworkId: string): Promise<IFramework | undefined> {
  return frameworkId
    ? queryClient.fetchQuery({ queryKey: ['framework', frameworkId], queryFn: () => getFramework(frameworkId), staleTime: 10 * 60 * 1000 })
    : undefined;
}

/** The job's allocation check plus knowlg-service's per-skill floor, against live counts and the set's own settings; throws if the searches fail. */
export async function checkPool(
  skills: string[], target: DifficultyTarget, framework: IFramework | undefined, channel: string | undefined, settings: DynamicAssessSettings,
): Promise<string[]> {
  const [buckets, skillCounts] = await poolCounts(deepestCategoryCode(framework), skills, channel);
  return poolProblems(skills, target, buckets, skillCounts, settings);
}

/** Live counts the pool checks read: per skill x level (job allocation) and per skill (knowlg-service floor); throws if the searches fail. */
export function poolCounts(categoryField: string, skills: string[], channel?: string) {
  return Promise.all([questionBucketCounts(categoryField, skills, channel), questionSkillCounts(categoryField, skills)]);
}

/** Child ids + lastUpdatedOn — either changing means the job's /add (and /remove) landed. */
function snapshot(node: INode | undefined): string {
  const ids = (node?.children ?? []).map((c) => c.identifier).join(',');
  return `${ids}|${String(node?.metadata?.lastUpdatedOn ?? '')}`;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Refresh-body, then poll until the job has finished both its /add and /remove; stopping at the first change could keep the old children and a later save would re-attach them. */
export async function generateAndWait(
  deps: Omit<GenerateDeps, 'save'>, baselineRoot: INode | undefined,
): Promise<{ result: GenerateResult; rootNode?: INode }> {
  const sleep = deps.sleep ?? defaultSleep;
  const pollMs = deps.pollMs ?? GENERATE_POLL_MS;
  const maxAttempts = deps.maxAttempts ?? GENERATE_POLL_MAX_ATTEMPTS;
  const cancelled = deps.isCancelled ?? (() => false);
  const baseline = snapshot(baselineRoot);
  if (cancelled()) return { result: 'cancelled' };
  await deps.refresh(deps.contentId);

  let latest: INode | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(pollMs);
    if (cancelled()) return { result: 'cancelled' };
    // A failed read (e.g. a network blip) is retried on the next attempt; giving up here would unblock saving mid-write.
    let current: INode | undefined;
    try { current = (await deps.read(deps.contentId)).rootNode; } catch { continue; }
    if (cancelled()) return { result: 'cancelled' };
    latest = current;
    if (snapshot(latest) !== baseline && isGenerationComplete(latest)) return { result: 'generated', rootNode: latest };
  }
  return { result: 'pending', rootNode: latest };
}

/** Save, then generate: inputs only exist in treeCache until saved. */
export async function saveThenGenerate(deps: GenerateDeps): Promise<{ result: GenerateResult; rootNode?: INode }> {
  // Only a completed save persisted Skill/Target; 'not-attempted' (e.g. a save already in flight) must not generate from the old settings.
  if ((await deps.save()) !== 'saved') return { result: 'failed' };
  // Baseline after the save, since the save itself bumps lastUpdatedOn.
  return generateAndWait(deps, (await deps.read(deps.contentId)).rootNode);
}

/** Dynamic Assess generation (Save & Generate, Regenerate): failures toast and return false; a failed save has already toasted and reverted. */
export function useRefreshQuestionSetBody() {
  const config = useEditorStore((s) => s.editorConfig);
  const setButtonLoader = useEditorStore((s) => s.setButtonLoader);
  const setTreeData = useTreeStore((s) => s.setTreeData);
  const { saveWithOutcome } = useSaveHierarchy();
  const validateRequiredFields = useValidateRequiredFields();

  /** With saveIfBlocked (the Save button), a pool or input problem still saves the other edits and says the questions weren't regenerated. */
  const refresh = useCallback(async (opts: { saveIfBlocked?: boolean } = {}): Promise<boolean> => {
    const contentId = getContentId(config?.context);
    if (!contentId) {
      notifyError(label('messages.error.001', 'No content identifier found.'));
      return false;
    }
    // Same required-field gate as Save as Draft; it opens the missing-fields modal itself.
    if (!validateRequiredFields()) return false;

    const isCancelled = sessionCancelledCheck();
    setButtonLoader('refreshBody', true);
    const blocked = async (reason: string): Promise<boolean> => {
      if (opts.saveIfBlocked && (await saveWithOutcome()) === 'saved') {
        // Reload so the editor knows the just-saved settings, which drive the "settings changed" banner.
        try {
          const { rootNode } = await readHierarchy(contentId);
          if (rootNode && !isCancelled()) setTreeData([rootNode]);
        } catch { /* the banner just catches up on the next open */ }
        notifyError(label('messages.error.dynamicAssessSavedNotGenerated', 'Saved, but the questions were not regenerated: {REASON}').replace('{REASON}', reason));
      } else {
        notifyError(reason);
      }
      return false;
    };
    try {
      // Check inputs and pool before saving, since the job fails silently on either.
      const { treeData, treeCache } = useTreeStore.getState();
      const rootId = treeData[0]?.identifier;
      const meta = { ...(treeData[0]?.metadata ?? {}), ...(rootId ? treeCache[rootId] ?? {} : {}) } as Record<string, unknown>;
      // The selection lives in the framework's deepest category field, so the framework is needed before the inputs can be read.
      let framework: IFramework | undefined;
      try {
        framework = await fetchFramework(resolveFrameworkId(config, meta.framework, useEditorStore.getState().contentFramework));
      } catch (err) {
        if (!isCancelled()) notifyError(label('messages.error.dynamicAssessPoolCheck', 'Could not verify question availability. Please try again.'), err);
        return false;
      }
      const skills = selectedSkills(meta, deepestCategoryCode(framework));
      const target = toDifficultyTarget(meta.difficultyTarget);
      if (!skills.length || (target.E ?? 0) + (target.M ?? 0) + (target.D ?? 0) <= 0) {
        return await blocked(inputsMessage());
      }
      const settings = dynamicAssessSettings(meta);
      // Like the other blocks, a target below the panel's minimum still saves the author's other edits (on Save) and says why nothing was generated.
      const tooLow = belowSkillMinimum(skills.length, target, settings);
      if (tooLow) return await blocked(tooLow);
      let problems: string[];
      try {
        problems = await checkPool(skills, target, framework, config?.context?.channel, settings);
      } catch (err) {
        if (!isCancelled()) notifyError(label('messages.error.dynamicAssessPoolCheck', 'Could not verify question availability. Please try again.'), err);
        return false;
      }
      if (isCancelled()) return false;
      if (problems.length) return await blocked(problems.join(' '));

      const { result, rootNode } = await saveThenGenerate({
        contentId, save: saveWithOutcome, refresh: refreshQuestionSetBody, read: readHierarchy, isCancelled,
      });
      if (result === 'failed' || result === 'cancelled') return false;
      if (result === 'generated') {
        if (rootNode) setTreeData([rootNode]);
        notifySuccess(label('messages.success.dynamicAssessRefresh', 'Questions generated'));
        return true;
      }
      // The job may be mid-write (old + new children): keep that tree out of the editor and pause saving until it's reopened, unless there's nothing a save could write back.
      if (shouldPauseAfterPending(useTreeStore.getState().treeData[0])) setButtonLoader('refreshPending', true);
      notifyError(generationPendingMessage());
      return false;
    } catch (err) {
      console.error('[useRefreshQuestionSetBody] refresh failed', err);
      if (isCancelled()) return false;
      notifyError(
        skillPoolErrorMessage(err)
          ?? apiErrorMessage(err, label('messages.error.dynamicAssessRefresh', 'Failed to generate questions. Please try again.')),
        err,
      );
      return false;
    } finally {
      // A newer editor session reset this loader itself and may be running its own generation.
      if (!isCancelled()) setButtonLoader('refreshBody', false);
    }
  }, [config, setButtonLoader, setTreeData, saveWithOutcome, validateRequiredFields]);

  return { refresh };
}

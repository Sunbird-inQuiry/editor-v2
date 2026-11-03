import { useState, useEffect } from 'react';
import type { IEditorConfig } from '../types/editor';
import { useEditorStore } from '../store/editor.store';
import { useTreeStore } from '../store/tree.store';
import { readHierarchy, readQuestionSet, refreshQuestionSetBody } from '../api/hierarchy';
import { getCategoryDefinition } from '../api/categoryDefinition';
import { setApiBaseUrl, setApiSlug } from '../api/client';
import { getContentId, isDynamicAssessQuestionSet, resolvePrimaryCategory } from '../utils/context';
import { label, resolveUiLanguage } from '../utils/labels';
import { apiErrorMessage, notifyError, notifySuccess } from '../utils/notify';
import { toDifficultyTarget } from '../utils/difficultyTarget';
import {
  checkPool, deepestCategoryCode, fetchFramework, generateAndWait, generationPendingMessage,
  shouldPauseAfterPending, skillPoolErrorMessage, startEditorSession,
} from './useRefreshQuestionSetBody';
import { dynamicAssessSettings, selectedSkills } from '../utils/dynamicAssessDraw';
import type { INode } from '../types/editor';
import type { IFramework } from '../types/framework';
import { resolveFrameworkId } from './useFramework';

interface UseEditorInitOptions {
  config: IEditorConfig;
  onError?: (e: Error) => void;
}

export function useEditorInit({ config, onError }: UseEditorInitOptions) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isReady, setIsReady] = useState(false);

  const { setEditorConfig, setEditorMode, setCategoryDefinition, setReviewComments, setLicenses, setChannelData } = useEditorStore();
  const { setTreeData, selectNode, mergeNodeMeta } = useTreeStore();

  useEffect(() => {
    let cancelled = false;
    // A generation still running from a previously opened set stops instead of writing into this one.
    startEditorSession();

    // Runs after the editor is ready, under the Generate loader, so nothing can be saved over the job's write.
    async function generateOnOpen(contentId: string, baselineRoot: INode | undefined) {
      const meta = (baselineRoot?.metadata ?? {}) as Record<string, unknown>;
      // The selection lives in the framework's deepest category field; it's read before the loader shows, so a set without one opens as before.
      let framework: IFramework | undefined;
      try {
        framework = await fetchFramework(resolveFrameworkId(config, meta.framework));
      } catch {
        return; // the selection can't be read, so generation is left to Save & Generate
      }
      const skills = selectedSkills(meta, deepestCategoryCode(framework));
      if (cancelled || !skills.length) return;

      const { setButtonLoader } = useEditorStore.getState();
      setButtonLoader('refreshBody', true);
      try {
        // Same pool check as Save & Generate, so settings the job can't fill don't block every open for the whole poll.
        let problems: string[];
        try {
          problems = await checkPool(skills, toDifficultyTarget(meta.difficultyTarget), framework, config.context.channel, dynamicAssessSettings(meta));
        } catch (err) {
          if (!cancelled) notifyError(label('messages.error.dynamicAssessPoolCheck', 'Could not verify question availability. Please try again.'), err);
          return;
        }
        if (cancelled) return;
        if (problems.length) { notifyError(problems.join(' ')); return; }

        const { result, rootNode } = await generateAndWait(
          { contentId, refresh: refreshQuestionSetBody, read: readHierarchy, isCancelled: () => cancelled }, baselineRoot,
        );
        if (cancelled || result === 'cancelled') return;
        if (result === 'generated') {
          if (rootNode) { setTreeData([rootNode]); selectNode(rootNode.id); }
          notifySuccess(label('messages.success.dynamicAssessRefresh', 'Questions generated'));
        } else {
          // The editor still holds the empty tree, so saving stays allowed (it would generate); pausing would lock the author out on every open.
          if (shouldPauseAfterPending(useTreeStore.getState().treeData[0])) setButtonLoader('refreshPending', true);
          notifyError(generationPendingMessage());
        }
      } catch (err) {
        if (!cancelled) notifyError(skillPoolErrorMessage(err) ?? apiErrorMessage(err, label('messages.error.dynamicAssessInit', 'Failed to generate questions for this question set.')), err);
      } finally {
        // A newer editor resets the loaders itself and may be running its own generation, so only this editor clears its own.
        if (!cancelled) setButtonLoader('refreshBody', false);
      }
    }

    async function init() {
      let autoGenerate = false;
      let baselineRoot: INode | undefined;
      try {
        setIsLoading(true);
        setError(null);

        if (config.apiBaseUrl) setApiBaseUrl(config.apiBaseUrl);
        if (config.config.apiSlug) setApiSlug(config.config.apiSlug);

        setEditorConfig(config);
        setEditorMode(config.config.mode);
        // The store outlives a single editor, so drop any generation state from a previously opened set.
        useEditorStore.getState().setButtonLoader('refreshPending', false);
        useEditorStore.getState().setButtonLoader('refreshBody', false);
        // UI labels — old ConfigService setLanguage (context lang → app-language).
        useEditorStore.getState().setUiLanguage(
          resolveUiLanguage(config.context.uiLanguage),
          config.context.labels,
        );

        const contentId = getContentId(config.context);

        if (contentId) {
          const { rootNode } = await readHierarchy(contentId);

          // Auto-generate an empty set on open, only for its author and only with a saved target; generateOnOpen checks the saved skills once the framework names their field.
          const rootMeta = (rootNode?.metadata ?? {}) as Record<string, unknown>;
          const target = toDifficultyTarget(rootMeta.difficultyTarget);
          autoGenerate =
            config.config.mode === 'edit' &&
            isDynamicAssessQuestionSet(resolvePrimaryCategory(config.config.primaryCategory, rootNode)) &&
            (rootNode?.children?.length ?? 0) === 0 &&
            (target.E ?? 0) + (target.M ?? 0) + (target.D ?? 0) > 0;
          baselineRoot = rootNode;

          if (!cancelled) {
            const nodes = rootNode ? [rootNode] : [];
            setTreeData(nodes);
            if (rootNode) selectNode(rootNode.id);
          }

          // Fetch fields absent from the hierarchy response (instructions, outcomeDeclaration).
          // mergeNodeMeta refreshes activeNodeMeta immediately WITHOUT marking the set dirty.
          if (rootNode && !cancelled) {
            try {
              const extra = await readQuestionSet(contentId);
              if (!cancelled && Object.keys(extra).length > 0) {
                mergeNodeMeta(rootNode.id, extra);
              }
            } catch { /* non-critical — form still renders without instructions */ }
          }

          const primaryCategory = config.config.primaryCategory ?? 'Question Set';
          const channel = config.context.channel ?? '';
          const apiVersion = config.config.categoryDefinitionApiVersion ?? 'v1';
          try {
            const parsed = await getCategoryDefinition(
              primaryCategory, channel, config.config.objectType ?? 'QuestionSet', apiVersion,
            );
            if (!cancelled) {
              setCategoryDefinition(parsed);

              const configPatch: Record<string, unknown> = {};
              // Hierarchy depth comes from objectMetadata.config.maxDepth —
              // sourcingSettings.collection.maxDepth is a contribution-flow
              // setting (often 1) and must not cap the edit hierarchy.
              if (parsed.maxDepth && !config.config.maxDepth) configPatch.maxDepth = parsed.maxDepth;
              if (Object.keys(configPatch).length > 0) {
                setEditorConfig({ ...config, config: { ...config.config, ...configPatch } });
              }
            }
          } catch {
            // silently fall back
          }

          if (config.config.mode !== 'read') {
            try {
              const { readComments } = await import('../api/comments');
              const comments = await readComments(contentId);
              if (!cancelled) setReviewComments(comments);
            } catch { /* silent */ }
          }
        }

        // Old helper.service.initialize(channel): channel read + licenses —
        // non-blocking, feeds license options and channel defaults.
        void (async () => {
          try {
            const { getLicenses } = await import('../api/license');
            const licenses = await getLicenses();
            if (!cancelled) setLicenses(licenses);
          } catch { /* license field falls back to free text */ }
        })();
        void (async () => {
          try {
            if (config.context.channel) {
              const { getChannelData } = await import('../api/channel');
              const channel = await getChannelData(config.context.channel);
              if (!cancelled) setChannelData(channel as unknown as Record<string, unknown>);
            }
          } catch { /* non-fatal */ }
        })();

        if (!cancelled) setIsReady(true);
        const contentIdForGenerate = getContentId(config.context);
        if (!cancelled && autoGenerate && contentIdForGenerate) void generateOnOpen(contentIdForGenerate, baselineRoot);
      } catch (err) {
        if (!cancelled) {
          const e = err instanceof Error ? err : new Error(String(err));
          setError(e);
          onError?.(e);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    init();
    return () => { cancelled = true; startEditorSession(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.context.contentId, config.context.identifier]);

  return { isLoading, error, isReady };
}

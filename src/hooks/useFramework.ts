import { useMemo } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { useEditorStore } from '../store/editor.store';
import { useTreeStore } from '../store/tree.store';
import { getFramework } from '../api/framework';
import { queryClient } from '../queryClient';
import type { IFramework, ITerm } from '../types/framework';

/**
 * @param overrideFrameworkId - Resolves categories against this framework
 * instead of the root/live one, fully locally to the caller — e.g. a
 * question that picked its own Framework in its Details form. Does not
 * touch editor.store's contentFramework or affect any other caller; target
 * frameworks still come from root (questions have no targetFWIds concept of
 * their own). Omit for the existing root-level behaviour, unchanged.
 */
export function useFramework(overrideFrameworkId?: string) {
  const config = useEditorStore((s) => s.editorConfig);
  // Old editor precedence: the questionset's own framework/targetFWIds (read
  // via the hierarchy API) win over the host-supplied context — the host
  // value is only a fallback for when the questionset itself has none.
  const rootMeta = useTreeStore((s) => s.treeData[0]?.metadata) as Record<string, unknown> | undefined;
  const frameworkIds = rootMeta?.framework
    ? [rootMeta.framework as string]
    : config?.context?.framework ? [config.context.framework] : (config?.config?.framework ?? []);
  const targetFWIds = (rootMeta?.targetFWIds as string[] | undefined)
    ?? config?.context?.targetFWIds ?? config?.config?.targetFWIds ?? [];

  // A live pick in the "framework" field itself (SparkMetaForm) overrides
  // the content's own saved framework immediately, without needing a
  // save/reload round trip first — see editor.store.ts's contentFramework.
  const liveFramework = useEditorStore((s) => s.contentFramework);
  const orgFrameworkId = overrideFrameworkId || liveFramework || frameworkIds[0] || '';

  const orgQuery = useQuery<IFramework>({
    queryKey: ['framework', orgFrameworkId],
    queryFn: () => getFramework(orgFrameworkId),
    enabled: !!orgFrameworkId,
    staleTime: 10 * 60 * 1000,
  });

  // Old editor reads every target framework too (setTargetFrameworkData).
  const targetResults = useQueries({
    queries: targetFWIds.map((fwId) => ({
      queryKey: ['framework', fwId],
      queryFn: () => getFramework(fwId as string),
      enabled: !!fwId,
      staleTime: 10 * 60 * 1000,
    })),
  });
  const targetDatas = targetResults.map((q) => q.data);
  const targetData = targetDatas.filter(Boolean) as IFramework[];
  // Scalar dep — an array spread would change the deps length as queries
  // resolve (or when targetFWIds itself changes), violating the Rules of Hooks.
  const targetKey = targetDatas.map((d) => d?.identifier ?? '').join(',');

  const frameworkTerms = useMemo<Map<string, Array<ITerm>>>(() => {
    const map = new Map<string, Array<ITerm>>();
    const addCategories = (fw?: IFramework) => {
      for (const cat of fw?.categories ?? []) {
        const existing = map.get(cat.code) ?? [];
        const seen = new Set(existing.map((t) => t.identifier));
        const merged = [...existing, ...(cat.terms ?? []).filter((t) => !seen.has(t.identifier))];
        map.set(cat.code, merged);
      }
    };
    addCategories(orgQuery.data);
    targetData.forEach(addCategories);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgQuery.data, targetKey]);

  // Category codes ordered by the ORG framework's own `index` (ascending) —
  // target frameworks only contribute extra term data, not this content's
  // taxonomy depth. Missing indexes sort last so a malformed entry can't
  // accidentally become "highest index" and unlock multiselect it shouldn't
  // have. Consumers (SparkMetaForm's single-vs-multi-select rule) treat the
  // last entry as the skill-equivalent leaf category.
  const categoryOrder = useMemo<string[]>(
    () => [...(orgQuery.data?.categories ?? [])]
      .sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity))
      .map((c) => c.code),
    [orgQuery.data],
  );

  return {
    orgFramework: orgQuery.data,
    targetFrameworks: targetData,
    isLoading: orgQuery.isLoading,
    targetFrameworkIds: targetFWIds as string[],
    frameworkTerms,
    categoryOrder,
  };
}

/**
 * Same target-framework precedence useFramework() applies internally
 * (rootMeta.targetFWIds wins over the host-supplied config) — extracted for
 * plain, non-hook code that needs to resolve the same ids without
 * subscribing to store changes (useSaveQuestion.ts, reading straight out of
 * getState() at save time to sweep target frameworks' categories into the
 * taxonomy payload, same as this hook's frameworkTerms merge does).
 */
export function resolveTargetFrameworkIds(): string[] {
  const config = useEditorStore.getState().editorConfig;
  const rootMeta = useTreeStore.getState().treeData[0]?.metadata as Record<string, unknown> | undefined;
  return ((rootMeta?.targetFWIds as string[] | undefined)
    ?? config?.context?.targetFWIds ?? config?.config?.targetFWIds ?? []) as string[];
}

/**
 * Every category code seen across ANY framework fetched this session (the
 * query cache) — the full universe of fields a framework switch could ever
 * have populated, not just the one framework being switched away from.
 *
 * Two frameworks can define the SAME category code with different terms
 * (e.g. both TPD and USF using `industry`/`domain`/`skill`) — clearing only
 * the outgoing framework's own codes leaves a shared code's VALUE sitting
 * in state, so it silently reappears pre-filled the moment a framework that
 * also has that code is selected, even though the user never entered it
 * under the new framework. Clearing this entire known universe on every
 * framework switch (ContextualEditor.tsx's handleFrameworkChange) — not
 * just the outgoing framework's codes — guarantees no such carryover.
 */
export function allKnownFrameworkCategoryCodes(): Set<string> {
  const codes = new Set<string>();
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ['framework'] })) {
    const data = query.state.data as IFramework | undefined;
    for (const c of data?.categories ?? []) codes.add(c.code);
  }
  return codes;
}

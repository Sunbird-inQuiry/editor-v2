import { useQuery } from '@tanstack/react-query';
import { useTreeStore } from '../store/tree.store';
import { useEditorStore } from '../store/editor.store';
import { resolveFrameworkId } from './useFramework';
import { deepestCategoryCode } from './useRefreshQuestionSetBody';
import { useIsDynamicAssess } from './useIsDynamicAssess';
import { getFramework } from '../api/framework';
import type { IFramework } from '../types/framework';

/** The field Dynamic pool questions carry their skill in: the framework's deepest category (e.g. "topic" on BMGS), else "skill". */
export function useDynamicSkillField(): string {
  const isDynamicAssess = useIsDynamicAssess();
  const rootFramework = useTreeStore((s) => {
    const root = s.treeData[0];
    return (root ? s.treeCache[root.identifier]?.framework : undefined) ?? root?.metadata?.framework;
  });
  // Same id the form's framework fields come from, including a host-supplied context framework.
  const config = useEditorStore((s) => s.editorConfig);
  const liveFramework = useEditorStore((s) => s.contentFramework);
  const framework = resolveFrameworkId(config, rootFramework, liveFramework);
  // Subscribed (same key and staleTime as useFramework), so the field updates once the framework loads; never runs for other categories.
  const { data } = useQuery<IFramework>({
    queryKey: ['framework', framework],
    queryFn: () => getFramework(framework),
    enabled: isDynamicAssess && !!framework,
    staleTime: 10 * 60 * 1000,
  });
  return deepestCategoryCode(data);
}

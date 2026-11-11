import { useEditorStore } from '../store/editor.store';
import { useTreeStore } from '../store/tree.store';
import { isDynamicAssessQuestionSet, resolvePrimaryCategory } from '../utils/context';

/** Whether the open set is a Dynamic QuestionSet, from the host config or, when the host omits it, the loaded root. */
export function useIsDynamicAssess(): boolean {
  const configCategory = useEditorStore((s) => s.editorConfig?.config?.primaryCategory);
  // Selects the root's category string, not the node, so tree edits don't re-render every caller.
  const rootCategory = useTreeStore((s) => resolvePrimaryCategory(undefined, s.treeData[0]));
  return isDynamicAssessQuestionSet(resolvePrimaryCategory(configCategory, { primaryCategory: rootCategory }));
}

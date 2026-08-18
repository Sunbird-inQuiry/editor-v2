import { useCallback } from 'react';
import { useTreeStore } from '../store/tree.store';
import { useEditorStore } from '../store/editor.store';
import { useUiStore } from '../store/ui.store';
import type { MissingFieldGroup } from '../components/modals/MissingRequiredFieldsModal';
import type { INode } from '../types/editor';
import { detectNodeKind } from '../utils/nodeKind';
import { findMissingRequiredFields, adaptFieldsForFramework } from '../components/SparkMetaForm/SparkMetaForm';
import { label } from '../utils/labels';
import { useSaveHierarchy } from './useSaveHierarchy';
import { useFramework } from './useFramework';

/**
 * Validates root + all sections' required fields (same check "Save as Draft"
 * runs), surfaces MissingRequiredFieldsModal via ui.store on failure, and
 * saves the hierarchy on success. Shared by the toolbar's Save-as-Draft and
 * OutlineTree's auto-save-on-click (Add Section / Add Question).
 */
export function useValidateAndSave() {
  const { save } = useSaveHierarchy();
  const setMissingFieldGroups = useUiStore((s) => s.setMissingFieldGroups);
  // Same framework the root's own Audience & Curriculum tab resolves —
  // required here so "missing required fields" is checked against the
  // framework-ADAPTED field list (adaptFieldsForFramework), not the raw
  // category-definition fields, which never change with the framework and
  // would keep flagging e.g. Industry/Domain/Skill as required under a
  // framework (CBSE, NCF, ...) that doesn't even have those categories.
  const { frameworkTerms, categoryOrder } = useFramework();

  const validateAndSave = useCallback(async (): Promise<boolean> => {
    const { rootFormConfig, unitFormConfig } = useEditorStore.getState();
    const { treeData, treeCache } = useTreeStore.getState();

    const liveMeta = (node: INode) =>
      ({ ...(node.metadata ?? {}), ...(treeCache[node.id] ?? {}) }) as Record<string, unknown>;

    const TAB_LABELS: Record<string, string> = {
      'Audience & Curriculum': label('ui.audience', 'Audience & Curriculum'),
      Behaviour: label('ui.behaviour', 'Behaviour'),
    };
    const detailsLabel = label('ui.details', 'Details');
    const order: string[] = [];
    const byGroup = new Map<string, string[]>();
    const addMissing = (
      fields: typeof rootFormConfig,
      meta: Record<string, unknown>,
      isRoot: boolean,
      sectionName?: string,
    ) => {
      // Framework-driven category fields (board/medium/gradeLevel/subject,
      // or a framework's own Industry/Domain/Skill) only ever have a
      // rendered home on the ROOT's Audience & Curriculum tab —
      // ContextualEditor.tsx's SECTION_TABS has no such tab, so a section
      // can never actually fill them in. Only adapt (and require) for
      // root; a section's own required fields come straight from its raw
      // unitFormConfig (Details/Behaviour only).
      const adapted = isRoot
        ? adaptFieldsForFramework(fields ?? [], frameworkTerms, categoryOrder, isRoot)
        : (fields ?? []);
      for (const f of findMissingRequiredFields(adapted, meta)) {
        const tab = (f.section && TAB_LABELS[f.section]) || detailsLabel;
        const group = sectionName ? `${sectionName} — ${tab}` : tab;
        if (!byGroup.has(group)) { byGroup.set(group, []); order.push(group); }
        byGroup.get(group)!.push(f.label);
      }
    };

    const rootNode = treeData[0];
    if (rootNode) addMissing(rootFormConfig, liveMeta(rootNode), true);

    const sections: typeof treeData = [];
    const queue = [...(rootNode?.children ?? [])];
    while (queue.length) {
      const n = queue.shift()!;
      if (detectNodeKind(n) === 'section') sections.push(n);
      if (n.children) queue.push(...n.children);
    }
    for (const section of sections) {
      addMissing(unitFormConfig, liveMeta(section), false, section.name);
    }

    if (order.length > 0) {
      const groups: MissingFieldGroup[] = order.map((tab) => ({ tab, fields: byGroup.get(tab)! }));
      setMissingFieldGroups(groups);
      return false;
    }

    // Skip the network round-trip when nothing is actually dirty (e.g.
    // rapidly adding several sections/questions in a row).
    if (!useEditorStore.getState().isDirty) return true;

    return save();
  }, [save, setMissingFieldGroups, frameworkTerms, categoryOrder]);

  return validateAndSave;
}
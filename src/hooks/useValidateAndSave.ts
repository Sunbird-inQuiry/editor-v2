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
 * runs) and surfaces MissingRequiredFieldsModal via ui.store on failure.
 * Purely local — never touches the network and never mutates the tree.
 *
 * Split out from useValidateAndSave so a caller can tell "the form isn't
 * complete, so nothing was attempted" apart from "the save itself failed".
 * useValidateAndSave collapses both into a single `false`, which is fine for
 * validate-then-mutate callers but not for anything that has to decide
 * whether there is something to roll back.
 */
export function useValidateRequiredFields(): () => boolean {
  const setMissingFieldGroups = useUiStore((s) => s.setMissingFieldGroups);
  // Same framework the root's own Audience & Curriculum tab resolves —
  // required here so "missing required fields" is checked against the
  // framework-ADAPTED field list (adaptFieldsForFramework), not the raw
  // category-definition fields, which never change with the framework and
  // would keep flagging e.g. Industry/Domain/Skill as required under a
  // framework (CBSE, NCF, ...) that doesn't even have those categories.
  const { frameworkTerms, categoryOrder } = useFramework();

  const validateRequiredFields = useCallback((): boolean => {
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

    return true;
  }, [setMissingFieldGroups, frameworkTerms, categoryOrder]);

  return validateRequiredFields;
}

/**
 * Required-field check followed by a hierarchy save. Shared by the toolbar's
 * Save-as-Draft and OutlineTree's auto-save-on-click (Add Section / Add
 * Question).
 *
 * NOTE for callers: `false` means EITHER "required fields are missing, so no
 * save was attempted" OR "the save failed". Only use this where those two
 * warrant the same handling — i.e. validate-then-mutate, with nothing done
 * yet that would need undoing. If you have already mutated the tree or
 * created a backend object, use useValidateRequiredFields() up front and
 * useSaveHierarchy().saveWithOutcome() afterwards instead.
 */
export function useValidateAndSave() {
  const { save } = useSaveHierarchy();
  const validateRequiredFields = useValidateRequiredFields();

  const validateAndSave = useCallback(async (): Promise<boolean> => {
    if (!validateRequiredFields()) return false;

    // Skip the network round-trip when nothing is actually dirty (e.g.
    // rapidly adding several sections/questions in a row).
    if (!useEditorStore.getState().isDirty) return true;

    return save();
  }, [save, validateRequiredFields]);

  return validateAndSave;
}
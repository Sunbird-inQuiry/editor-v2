import type { ICategoryField } from '../api/categoryDefinition';

/** How the question Difficulty picker shows: driven by a `difficultyLevel` field in the question's form config when there is one, else shown and editable as before. */
export function difficultyLevelField(formConfig: ICategoryField[] | null | undefined): { visible: boolean; editable: boolean; label?: string } {
  const field = formConfig?.find((f) => f.code === 'difficultyLevel');
  if (!field) return { visible: true, editable: true };
  return { visible: field.visible !== false, editable: field.editable !== false, label: field.label || undefined };
}

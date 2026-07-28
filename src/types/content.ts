export interface IContent {
  identifier: string;
  name: string;
  description?: string;
  mimeType?: string;
  contentType?: string;
  primaryCategory?: string;
  questionType?: string;
  appIcon?: string;
  channel?: string;
  organisation?: string[];
  framework?: string;
  status?: string;
  visibility?: string;
  pkgVersion?: number;
  subject?: string[];
  gradeLevel?: string[];
}

export interface ILibraryItem extends IContent {
  isSelected?: boolean;
  isDragging?: boolean;
}

// Matches the registry's question-type primaryCategory values exactly
// (src/registry/defaultQuestionTypes.ts) — 'all' plus one chip per type.
// labelKey reuses the registry's own ui.type* keys (defaultQuestionTypes.ts)
// where the chip text matches verbatim, so translations aren't duplicated —
// this is a plain data file (no hooks), so L() itself is applied by the
// caller (LibraryDock), same pattern as the registry's label/labelKey pairs.
export const QUESTION_FILTERS: ReadonlyArray<{ label: string; labelKey: string; value: string }> = [
  { label: 'All', labelKey: 'ui.filterAll', value: 'all' },
  { label: 'Multiple Choice', labelKey: 'ui.typeMcq', value: 'Multiple Choice Question' },
  { label: 'Fill in the Blank', labelKey: 'ui.typeFtb', value: 'FTB Question' },
  { label: 'Subjective', labelKey: 'ui.typeSa', value: 'Subjective Question' },
  { label: 'Match', labelKey: 'ui.filterMatch', value: 'Match The Following Question' },
  { label: 'Sequence', labelKey: 'ui.typeSeq', value: 'Sequence Question' },
  { label: 'Reorder', labelKey: 'ui.typeReo', value: 'Reorder Question' },
  { label: 'True/False', labelKey: 'ui.typeBoolean', value: 'Boolean Question' },
];

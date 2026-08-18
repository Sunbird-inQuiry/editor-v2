import React, { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import type { ITerm } from '../../types/framework';
import { Icon } from '../shared/Icon';
import type { ICategoryField } from '../../api/categoryDefinition';
import { useEditorStore } from '../../store/editor.store';
import { searchFrameworks } from '../../api/framework';
import styles from './SparkMetaForm.module.scss';
import ImagePickerModal from '../shared/ImagePickerModal';
import ContentEditable from '../shared/ContentEditable';
import { htmlToText } from '../../utils/html';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Shape of a single framework term entry. */
export interface FrameworkTerm {
  name: string;
  identifier: string;
  code: string;
}

export interface SparkMetaFormProps {
  /** Field configuration array from category-definition API. */
  fields: ICategoryField[];
  /** Current field values (from activeNodeMeta or node metadata). */
  values: Record<string, unknown>;
  /** Called when a field value changes — (fieldCode, newValue). */
  onChange: (code: string, value: unknown) => void;
  /** Called when overall form validity changes. */
  onValidityChange?: (isValid: boolean) => void;
  /** When true, all inputs are disabled/read-only. */
  readOnly?: boolean;
  /**
   * When set, only fields whose `section` property matches this value are
   * rendered.  Fields with no `section` are shown when `section` is
   * undefined (i.e. the "Details" tab).
   */
  section?: string;
  /**
   * Bypasses the `section` tab logic entirely — every visible field is
   * rendered regardless of its own `section`. For a caller with no tabs at
   * all (the question editor's Details form, the read-only question meta
   * view): omitting `section` there would otherwise mean "show only the
   * untabbed fields" (root's Details-tab meaning), silently dropping any
   * framework-driven category field tagged 'Audience & Curriculum'.
   */
  showAllSections?: boolean;
  /**
   * Framework terms keyed by sourceCategory (e.g. "board", "medium",
   * "gradeLevel", "subject").  When provided, fields whose `sourceCategory`
   * matches a key will be populated from this map instead of falling back to
   * `field.range` / `field.enum`.
   *
   * Each term has shape: { name, identifier, code }
   * — `identifier` is used as the option value, `name` as the visible label.
   */
  frameworkTerms?: Map<string, FrameworkTerm[]>;
  /**
   * Category codes in framework order (ascending `index`), from the same
   * `useFramework()` call that produced `frameworkTerms` — see
   * `adaptFieldsForFramework`'s single-vs-multi-select rule below. Only
   * meaningful together with `isRoot`; omit for section/question forms.
   */
  categoryOrder?: string[];
  /**
   * True for the root (questionset-level) form only. The "framework" field
   * (code: 'framework') is special-cased to live-update which framework's
   * terms populate every other category dropdown on this same form — see
   * editor.store.ts's contentFramework — but that only makes sense at the
   * root, so section/question forms never have this set.
   */
  isRoot?: boolean;
}

// ---------------------------------------------------------------------------
// Timer helpers — convert seconds ↔ HH:mm:ss
// ---------------------------------------------------------------------------

function secondsToHms(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

function hmsToSeconds(hms: string): number {
  const parts = hms.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(hms) || 0;
}

// HH:mm timer input — keeps the typed digits in local state; committing on
// every keystroke and re-deriving from seconds would zero-pad ("1" → "01"),
// hit maxLength and block the second digit.
function TimerHmsField({ seconds, disabled, onCommit, onBlur }: {
  seconds: number;
  disabled?: boolean;
  onCommit: (secs: number) => void;
  onBlur?: () => void;
}) {
  const [hh, setHh] = useState('');
  const [mm, setMm] = useState('');

  const localSecs = (h: string, m: string) =>
    hmsToSeconds(`${(h || '0').padStart(2, '0')}:${(m || '0').padStart(2, '0')}:00`);

  // Re-sync only when the committed value changed externally (hydration/reset).
  useEffect(() => {
    if (localSecs(hh, mm) !== seconds) {
      const parts = secondsToHms(seconds).split(':');
      setHh(parts[0] === '00' ? '' : (parts[0] ?? ''));
      setMm(parts[1] === '00' ? '' : (parts[1] ?? ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds]);

  const change = (h: string, m: string) => {
    setHh(h);
    setMm(m);
    onCommit(localSecs(h, m));
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        type="text" maxLength={2} placeholder="HH"
        className={styles.input}
        style={{ width: 72, textAlign: 'center' }}
        value={hh}
        onChange={e => change(e.target.value.replace(/\D/g, ''), mm)}
        onBlur={onBlur}
        disabled={disabled}
      />
      <span style={{ fontWeight: 700, color: 'var(--sb-text-muted)', fontSize: 18 }}>:</span>
      <input
        type="text" maxLength={2} placeholder="mm"
        className={styles.input}
        style={{ width: 72, textAlign: 'center' }}
        value={mm}
        onChange={e => change(hh, e.target.value.replace(/\D/g, ''))}
        onBlur={onBlur}
        disabled={disabled}
      />
      {!disabled && (
        <button
          type="button"
          onClick={() => change('', '')}
          className="ce-btn ghost"
          style={{ height: 38, padding: '0 14px', fontSize: 13 }}
        >
          Reset
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types for range items (framework-driven options)
// ---------------------------------------------------------------------------

interface RangeItem {
  name: string;
  identifier: string;
}

function isRangeItem(v: unknown): v is RangeItem {
  return typeof v === 'object' && v !== null && 'name' in v && 'identifier' in v;
}

// ---------------------------------------------------------------------------
// Field section matching logic
// ---------------------------------------------------------------------------

/**
 * A field is shown in a tab when:
 *  - `section` prop is undefined  →  show fields that have no section, or
 *    whose section is not one of the named tabs (they fall into "Details").
 *  - `section` prop is defined    →  show only fields whose `field.section`
 *    exactly matches the prop.
 */
const NAMED_SECTIONS = ['Audience & Curriculum', 'Licensing'];

/** Exported so callers (e.g. ContextualEditor's tab bar) can check whether a
 *  given tab's section has any required field, using the exact same
 *  matching rule the tab's own <SparkMetaForm section="..."/> render uses.
 *  `showAllSections` bypasses the tab logic entirely — for a caller with no
 *  tabs at all (the question editor's Details form, the read-only question
 *  meta view), where "undefined section" must mean "show everything",
 *  not "show only the untabbed fields" (root's actual meaning for it). */
export function fieldMatchesSection(field: ICategoryField, section?: string, showAllSections?: boolean): boolean {
  if (showAllSections) return true;
  if (section === undefined) {
    // Details tab: include fields with no section or unknown section
    return !field.section || !NAMED_SECTIONS.includes(field.section);
  }
  return field.section === section;
}

// ---------------------------------------------------------------------------
// Skill needs a searchable multi-select regardless of what the category
// definition's own inputType says — matched on code AND label since the
// live config's exact field code isn't something this file can see ahead
// of time.
// ---------------------------------------------------------------------------

function isSkillField(field: ICategoryField): boolean {
  return field.code?.toLowerCase() === 'skill' || field.label?.toLowerCase() === 'skill';
}

function isMultiSelectField(field: ICategoryField): boolean {
  return field.inputType === 'multiselect' || isSkillField(field);
}

// ---------------------------------------------------------------------------
// Build per-field Zod validator (returns error message string | undefined)
// ---------------------------------------------------------------------------

function makeFieldValidator(field: ICategoryField) {
  return (value: unknown): string | true => {
    const inputType = isMultiSelectField(field) ? 'multiselect' : (field.inputType ?? 'text');

    if (inputType === 'multiselect' || inputType === 'keywords') {
      const arr = Array.isArray(value) ? value : [];
      if (field.required && arr.length === 0) {
        return `${field.label} is required`;
      }
      return true;
    }

    if (inputType === 'checkbox') {
      // checkboxes are never "required" in the traditional sense
      return true;
    }

    const str = value !== undefined && value !== null
      ? (inputType === 'richtext'
          ? htmlToText(String(value))
          : String(value)
        ).trim()
      : '';

    if (field.required && str.length === 0) {
      return `${field.label} is required`;
    }

    if (field.maxLength && str.length > field.maxLength) {
      return `${field.label} must be at most ${field.maxLength} characters`;
    }

    return true;
  };
}

// ---------------------------------------------------------------------------
// Required-field check across an arbitrary field set — used to validate all
// tabs at once (each tab only mounts its own SparkMetaForm, so per-tab
// onValidityChange only ever reflects the currently visible tab).
// ---------------------------------------------------------------------------

export function findMissingRequiredFields(
  fields: ICategoryField[],
  values: Record<string, unknown>,
): ICategoryField[] {
  return fields.filter((f) => {
    if (!f.visible || !f.required) return false;
    return makeFieldValidator(f)(values[f.code]) !== true;
  });
}

// ---------------------------------------------------------------------------
// Helpers — build select/multiselect options
// ---------------------------------------------------------------------------

export interface SelectOption {
  value: string;
  label: string;
}

function buildOptions(
  field: ICategoryField,
  frameworkTerms?: Map<string, FrameworkTerm[]>,
): SelectOption[] {
  // 1. Framework terms — use sourceCategory if set, otherwise fall back to field.code.
  //    Sunbird stores board/medium/gradeLevel/subject as the term NAME (not identifier),
  //    so we use t.name as the option value to ensure the saved value matches.
  if (frameworkTerms) {
    const termKey = field.sourceCategory ?? field.code;
    const terms = frameworkTerms.get(termKey);
    if (terms && terms.length > 0) {
      return terms.map((t) => ({ value: t.name, label: t.name }));
    }
  }

  // 2. Inline range — can be { name, identifier } objects, plain strings, or numbers
  if (Array.isArray(field.range)) {
    return (field.range as unknown[]).map((item) => {
      if (item !== null && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const v = String(o.identifier ?? o.name ?? '');
        const l = String(o.label ?? o.name ?? v);
        return { value: v, label: l };
      }
      return { value: String(item), label: String(item) };
    });
  }

  // 3. Enum — plain string array
  if (Array.isArray(field.enum)) {
    return (field.enum as string[]).map((v) => ({ value: v, label: v }));
  }

  return [];
}

// ---------------------------------------------------------------------------
// Cascading options — filter child options by parent term's associations
// ---------------------------------------------------------------------------

function buildCascadedOptions(
  field: ICategoryField,
  frameworkTerms: Map<string, FrameworkTerm[]> | undefined,
  formValues: Record<string, unknown>,
): SelectOption[] {
  // No dependency declared — show all terms for this category
  if (!field.depends?.length || !frameworkTerms) {
    return buildOptions(field, frameworkTerms);
  }

  // Use the most specific parent (last entry in depends[])
  const parentCode = field.depends[field.depends.length - 1];
  const parentValue = String(formValues[parentCode] ?? '');

  // No parent selected yet → child list is empty
  if (!parentValue) return [];

  // Find the selected parent term
  const parentTerms = frameworkTerms.get(parentCode) ?? [];
  const parentTerm = parentTerms.find(t => t.name === parentValue) as ITerm | undefined;

  // Parent term not found in framework data
  if (!parentTerm) return [];

  // Return only the associations that belong to this child category
  const associatedOptions = (parentTerm.associations ?? [])
    .filter(a => a.category === field.code)
    .map(a => ({ value: a.name, label: a.name }));

  // Parent has no associations for this child category (e.g. a framework
  // hasn't authored them yet) → show all terms of the child category
  // instead of leaving the dropdown empty.
  return associatedOptions.length > 0 ? associatedOptions : buildOptions(field, frameworkTerms);
}

// ---------------------------------------------------------------------------
// Framework-conditional category fields — a field like Industry/Domain/Skill
// only makes sense for a framework that actually has those categories (e.g.
// USF); a standard K-12 framework (e.g. CBSE) has board/medium/gradeLevel/
// subject instead. Symmetric in both directions: drop a static field whose
// category isn't part of the selected framework, and synthesize a plain
// multiselect for any of the framework's categories not already covered by
// a kept field — same approach the collection editor's adaptFrameworkFields
// uses, generalized instead of hardcoded to the K-12 set specifically.
// ---------------------------------------------------------------------------

/** A field bound to a framework category (either explicitly via
 *  sourceCategory, or implicitly since buildOptions() falls back to
 *  frameworkTerms[field.code] first) — the only kind of field this
 *  adaptation should ever touch. An explicit sourceCategory always wins
 *  even if the field also carries a static range/enum fallback (that
 *  fallback only matters before framework data has loaded — buildOptions()
 *  still prefers frameworkTerms over it once available, so the field stays
 *  framework-bound either way). A select/multiselect field with no
 *  sourceCategory but ALSO fixed options of its own (license, maxQuestions,
 *  …) is never framework-specific. */
function isFrameworkDrivenField(field: ICategoryField): boolean {
  const isSelectLike = field.inputType === 'select' || isMultiSelectField(field);
  if (!isSelectLike) return false;
  if (field.sourceCategory) return true;
  const hasFixedOptions = Array.isArray(field.range) && field.range.length > 0
    || Array.isArray(field.enum) && field.enum.length > 0;
  return !hasFixedOptions;
}

// Exported so non-rendering callers (useValidateAndSave.ts's missing-
// required-fields check) can apply the exact same framework-conditional
// keep/drop/required rule this component's own render uses, instead of
// re-deriving "required" from the raw, framework-unaware category-
// definition fields directly.
export function adaptFieldsForFramework(
  fields: ICategoryField[],
  frameworkTerms: Map<string, FrameworkTerm[]> | undefined,
  categoryOrder: string[] | undefined,
  isRoot: boolean,
): ICategoryField[] {
  // No framework categories loaded yet (still fetching, or none selected) —
  // leave the static field list exactly as the category-definition API gave it.
  if (!frameworkTerms || frameworkTerms.size === 0) return fields;

  // frameworkTerms merges the ORG framework's categories with every TARGET
  // framework's (useFramework.ts) — fine for populating a kept field's term
  // OPTIONS, but wrong here: it means a target framework still carrying
  // board/medium/gradeLevel keeps those fields required even after the org
  // framework is switched to one with its own category set (e.g. USF's
  // Industry/Domain/Skill), since their codes never leave the merged map.
  // categoryOrder is ORG-only (useFramework.ts derives it solely from
  // orgQuery.data) — use it as the keep/drop authority when available (root
  // forms); fall back to the merged map for section/question forms, where
  // categoryOrder isn't wired up.
  const frameworkCategoryCodes = new Set(
    categoryOrder?.length ? categoryOrder : frameworkTerms.keys(),
  );
  // Only the highest-index (skill-equivalent leaf) category may hold more
  // than one term — Industry/Domain, Board/Medium/Grade etc. narrow down a
  // single path through the taxonomy. Root-only: a question's own category
  // fields keep whatever inputType the category definition's childForm
  // gave them (questionset creation is the only place this constraint was
  // asked for).
  const highestIndexCode = isRoot && categoryOrder?.length
    ? categoryOrder[categoryOrder.length - 1]
    : undefined;

  // A static field's own code doesn't always match the live framework's
  // category code — a category-definition form can name its board field
  // e.g. 'boardIds' while the framework's own category code is 'board',
  // with no sourceCategory to bridge the two. Falling back to a label
  // match (Board ~ board) catches that: without it, such a field (a) never
  // resolves its options from frameworkTerms (sits empty, since
  // buildOptions() looks it up by sourceCategory ?? code), AND (b) never
  // registers in keptCodes below, so the dynamic-synthesis loop adds a
  // SECOND field for the very same category — the duplicate Board/Medium/
  // GradeLevel/Subject rows this fixes.
  const resolveCategoryCode = (field: ICategoryField): string | undefined => {
    if (field.sourceCategory) return field.sourceCategory;
    if (frameworkCategoryCodes.has(field.code)) return field.code;
    const byLabel = field.label?.trim().toLowerCase();
    return byLabel && frameworkCategoryCodes.has(byLabel) ? byLabel : undefined;
  };

  const kept = fields
    .filter((f) => !isFrameworkDrivenField(f) || !!resolveCategoryCode(f))
    .map((f) => {
      if (!isFrameworkDrivenField(f)) return f;
      const categoryCode = resolveCategoryCode(f)!;
      // Stamp the resolved category back onto the field (when it only
      // matched via label) so buildOptions()/buildCascadedOptions() — which
      // only ever look at sourceCategory ?? code, not this function's own
      // resolution — also find the framework's live terms for it.
      const withSourceCategory = f.sourceCategory ? f : { ...f, sourceCategory: categoryCode };
      // required: true — a framework-driven category field is always
      // mandatory once the framework supplies it, at root and per-question
      // alike (matches the synthesized fields below).
      if (!highestIndexCode) return { ...withSourceCategory, required: true };
      return {
        ...withSourceCategory,
        required: true,
        inputType: categoryCode === highestIndexCode ? 'multiselect' : 'select',
      };
    });

  // buildOptions() already resolves a field's options from frameworkTerms
  // first (keyed by sourceCategory ?? code) — no range/enum needed here.
  // required: true — matches the static category fields these stand in for
  // (Industry/Domain/Skill/Audience are all required); leaving a framework's
  // own categories optional just because they happened to need synthesizing
  // would make curriculum categorization mandatory for some frameworks and
  // not others, depending purely on which one is selected.
  const keptCodes = new Set(kept.map((f) => f.sourceCategory ?? f.code));
  const dynamic: ICategoryField[] = [];
  for (const code of frameworkCategoryCodes) {
    if (keptCodes.has(code)) continue;
    dynamic.push({
      code,
      label: code.charAt(0).toUpperCase() + code.slice(1),
      inputType: !highestIndexCode || code === highestIndexCode ? 'multiselect' : 'select',
      required: true,
      editable: true,
      visible: true,
      section: 'Audience & Curriculum',
      sourceCategory: code,
    });
  }
  return dynamic.length ? [...kept, ...dynamic] : kept;
}

// ---------------------------------------------------------------------------
// Build default values for react-hook-form from external `values` prop
// ---------------------------------------------------------------------------

function buildDefaultValues(
  fields: ICategoryField[],
  values: Record<string, unknown>,
  section?: string,
  showAllSections?: boolean,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const f of fields) {
    if (!f.visible || !fieldMatchesSection(f, section, showAllSections)) continue;
    const v = values[f.code];
    if (isMultiSelectField(f) || f.inputType === 'keywords') {
      defaults[f.code] = Array.isArray(v) ? v : v ? [String(v)] : [];
    } else if (f.inputType === 'checkbox') {
      defaults[f.code] = Boolean(v);
    } else {
      // API stores board/medium/gradeLevel/subject as arrays — extract the first
      // element so the single-select value matches the option string.
      const scalar = Array.isArray(v) ? (v[0] ?? '') : v;
      defaults[f.code] = scalar !== undefined && scalar !== null ? String(scalar) : '';
    }
  }
  return defaults;
}

// ---------------------------------------------------------------------------
// Keyword chips sub-component
// ---------------------------------------------------------------------------

interface KeywordChipsProps {
  value: string[];
  onChange: (v: string[]) => void;
  readOnly?: boolean;
  placeholder?: string;
  fieldId: string;
}

const KeywordChips: React.FC<KeywordChipsProps> = ({
  value,
  onChange,
  readOnly = false,
  placeholder = 'Type and press Enter or comma…',
  fieldId,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const addChip = useCallback(
    (raw: string) => {
      const parts = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length === 0) return;
      const next = [...new Set([...value, ...parts])];
      onChange(next);
    },
    [value, onChange],
  );

  const removeChip = useCallback(
    (chip: string) => {
      onChange(value.filter((v) => v !== chip));
    },
    [value, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const inputVal = inputRef.current?.value ?? '';
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        addChip(inputVal);
        if (inputRef.current) inputRef.current.value = '';
      } else if (e.key === 'Backspace' && !inputVal && value.length > 0) {
        onChange(value.slice(0, -1));
      }
    },
    [addChip, value, onChange],
  );

  const handleBlur = useCallback(() => {
    const val = inputRef.current?.value ?? '';
    if (val.trim()) {
      addChip(val);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [addChip]);

  return (
    <div className={styles.chips} aria-label="Keywords">
      {value.map((chip) => (
        <span key={chip} className={styles.chip}>
          <span className={styles.chipLabel}>{chip}</span>
          {!readOnly && (
            <button
              type="button"
              className={styles.chipRemove}
              onClick={() => removeChip(chip)}
              aria-label={`Remove ${chip}`}
            >
              <Icon name="x" size={10} />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          ref={inputRef}
          id={fieldId}
          type="text"
          className={styles.chipsInput}
          placeholder={value.length === 0 ? placeholder : ''}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          aria-label="Add keyword"
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// MultiSelectSearch — searchable dropdown that toggles multiple selections,
// shown as chips (same chip styling as KeywordChips) inside the trigger box.
// ---------------------------------------------------------------------------

interface MultiSelectSearchProps {
  fieldId: string;
  value: string[];
  options: SelectOption[];
  onChange: (v: string[]) => void;
  readOnly?: boolean;
  placeholder?: string;
  hasError?: boolean;
}

const MultiSelectSearch: React.FC<MultiSelectSearchProps> = ({
  fieldId,
  value,
  options,
  onChange,
  readOnly = false,
  placeholder = 'Search…',
  hasError = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [panelRect, setPanelRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Portaled to document.body (see below) — the trigger sits inside
  // .ce-card, which needs overflow:hidden for its own rounded corners, and
  // that clips any absolutely-positioned descendant. Tracking the trigger's
  // own rect instead of nesting the panel under it sidesteps that entirely.
  useEffect(() => {
    if (!open) return;
    const updateRect = () => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (rect) setPanelRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    };
    updateRect();
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // The panel is portaled to document.body (see below), so a click inside
    // it is NOT a descendant of wrapRef — check both, or every option click
    // would close the panel via this handler before its own onClick fires.
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const labelOf = useCallback(
    (val: string) => options.find((o) => o.value === val)?.label ?? val,
    [options],
  );

  const toggle = useCallback(
    (val: string) => {
      onChange(value.includes(val) ? value.filter((v) => v !== val) : [...value, val]);
    },
    [value, onChange],
  );

  return (
    <div className={styles.multiSelectWrap} ref={wrapRef}>
      <div
        className={`${styles.chips} ${hasError ? styles.inputError : ''}`}
        onClick={() => { if (!readOnly) { setOpen(true); inputRef.current?.focus(); } }}
      >
        <Icon name="search" size={15} className={styles.msSearchIcon} />
        {value.map((v) => (
          <span key={v} className={styles.chip}>
            <span className={styles.chipLabel}>{labelOf(v)}</span>
            {!readOnly && (
              <button
                type="button"
                className={styles.chipRemove}
                onClick={(e) => { e.stopPropagation(); toggle(v); }}
                aria-label={`Remove ${labelOf(v)}`}
              >
                <Icon name="x" size={10} />
              </button>
            )}
          </span>
        ))}
        {!readOnly && (
          <input
            ref={inputRef}
            id={fieldId}
            type="text"
            className={styles.chipsInput}
            placeholder={value.length === 0 ? placeholder : ''}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            aria-label={placeholder}
          />
        )}
      </div>

      {open && !readOnly && panelRect && createPortal(
        <div
          ref={panelRef}
          className={styles.msPanel}
          style={{ position: 'fixed', top: panelRect.top, left: panelRect.left, width: panelRect.width }}
          role="listbox"
          aria-multiselectable="true"
        >
          {filtered.length === 0 ? (
            <div className={styles.msEmpty}>No matches</div>
          ) : (
            filtered.map((opt) => {
              const selected = value.includes(opt.value);
              return (
                <button
                  type="button"
                  key={opt.value}
                  className={`${styles.msOption} ${selected ? styles.msOptionSelected : ''}`}
                  onClick={() => toggle(opt.value)}
                  role="option"
                  aria-selected={selected}
                >
                  <span className={styles.msCheckbox}>{selected && <Icon name="check" size={11} />}</span>
                  <span>{opt.label}</span>
                </button>
              );
            })
          )}
        </div>,
        document.body,
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// SingleSelectDropdown — themed replacement for a native <select> (single
// value only, no search) — the OS-rendered native dropdown doesn't follow
// the app's own theme at all (see MultiSelectSearch above for the same
// portal/positioning approach, needed for the same .ce-card overflow:hidden
// clipping reason).
// ---------------------------------------------------------------------------

export interface SingleSelectDropdownProps {
  fieldId: string;
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  hasError?: boolean;
}

export const SingleSelectDropdown: React.FC<SingleSelectDropdownProps> = ({
  fieldId,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Select…',
  hasError = false,
}) => {
  const [open, setOpen] = useState(false);
  const [panelRect, setPanelRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const updateRect = () => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (rect) setPanelRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    };
    updateRect();
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const select = useCallback(
    (v: string) => {
      onChange(v);
      setOpen(false);
    },
    [onChange],
  );

  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <div className={styles.singleSelectWrap} ref={wrapRef}>
      <button
        type="button"
        id={fieldId}
        className={`${styles.select} ${styles.selectTrigger} ${hasError ? styles.inputError : ''}`}
        onClick={() => { if (!disabled) setOpen((o) => !o); }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selectedLabel ? undefined : styles.selectPlaceholderText}>
          {selectedLabel ?? placeholder}
        </span>
      </button>

      {open && !disabled && panelRect && createPortal(
        <div
          ref={panelRef}
          className={styles.msPanel}
          style={{ position: 'fixed', top: panelRect.top, left: panelRect.left, width: panelRect.width }}
          role="listbox"
        >
          <button
            type="button"
            className={styles.msOption}
            onClick={() => select('')}
            role="option"
            aria-selected={!value}
          >
            <span className={styles.msCheck}>{!value && <Icon name="check" size={13} />}</span>
            <span>{placeholder}</span>
          </button>
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                type="button"
                key={opt.value}
                className={`${styles.msOption} ${selected ? styles.msOptionSelected : ''}`}
                onClick={() => select(opt.value)}
                role="option"
                aria-selected={selected}
              >
                <span className={styles.msCheck}>{selected && <Icon name="check" size={13} />}</span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// AppIconPicker — image thumbnail that opens ImagePickerModal on click
// ---------------------------------------------------------------------------

function AppIconPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => !disabled && setOpen(true)}
        title={disabled ? undefined : 'Click to change icon'}
        style={{
          width: 72, height: 72, borderRadius: 14, border: '1.5px dashed var(--sb-border)',
          background: 'var(--sb-bg)', cursor: disabled ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', padding: 0, flexShrink: 0,
          transition: 'border-color .14s',
        }}
      >
        {value ? (
          <img src={value} alt="icon" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Icon name="image" size={28} style={{ color: 'var(--sb-text-faint)' }} />
        )}
      </button>
      {open && (
        <ImagePickerModal
          preserveAbsoluteUrl
          onSelect={(url) => { onChange(url); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// SparkMetaForm
// ---------------------------------------------------------------------------

const SparkMetaForm: React.FC<SparkMetaFormProps> = ({
  fields,
  values,
  onChange: onChangeProp,
  onValidityChange,
  readOnly = false,
  section,
  showAllSections = false,
  frameworkTerms,
  categoryOrder,
  isRoot = false,
}) => {
  const setContentFramework = useEditorStore((s) => s.setContentFramework);
  // Same query key as ContextualEditor's standalone Framework picker — this
  // only matters if a category-definition schema ever defines its own
  // 'framework'-coded field (handled generically in the "select" branch
  // below); channelData.frameworks isn't reliably populated (see
  // ContextualEditor.tsx), so this shares the same live search instead.
  const frameworkListQuery = useQuery({
    queryKey: ['framework-search'],
    queryFn: () => searchFrameworks(),
    staleTime: 10 * 60 * 1000,
  });
  const channelFrameworks = frameworkListQuery.data ?? [];

  // The "framework" field drives which framework's terms populate every
  // OTHER category dropdown on this form — switching it needs to update
  // editor.store.ts immediately (see useFramework.ts), not wait for save.
  const onChange = useCallback(
    (code: string, value: unknown) => {
      if (isRoot && code === 'framework') {
        setContentFramework(typeof value === 'string' && value ? value : null);
      }
      onChangeProp(code, value);
    },
    [isRoot, setContentFramework, onChangeProp],
  );

  // Drop/add category fields that don't/do belong to the selected framework
  // (e.g. Industry/Domain/Skill for USF vs board/medium/gradeLevel/subject
  // for a K-12 framework like CBSE) — see adaptFieldsForFramework above.
  const adaptedFields = useMemo(
    () => adaptFieldsForFramework(fields, frameworkTerms, categoryOrder, isRoot),
    [fields, frameworkTerms, categoryOrder, isRoot],
  );

  // Filter to only visible fields for this section
  // appIcon is handled by the card-header thumbnail, not the form.
  const visibleFields = adaptedFields.filter(
    (f) => f.visible && f.inputType !== 'appIcon' && fieldMatchesSection(f, section, showAllSections),
  );

  const {
    control,
    formState: { errors, isValid },
    reset,
    trigger,
    watch,
    setValue,
  } = useForm({
    defaultValues: buildDefaultValues(adaptedFields, values, section, showAllSections),
    mode: 'onChange',
  });

  // Current values of all form fields — used to compute cascaded options.
  const watchedValues = watch();

  // Map from each field code to the list of fields that depend on it.
  // Used to reset child fields when a parent changes.
  const dependentsMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const f of adaptedFields) {
      for (const dep of f.depends ?? []) {
        if (!map[dep]) map[dep] = [];
        map[dep].push(f.code);
      }
    }
    return map;
  }, [adaptedFields]);

  const resetDependents = useCallback((parentCode: string) => {
    for (const dep of dependentsMap[parentCode] ?? []) {
      setValue(dep, '');
      onChange(dep, '');
      // Recursively reset grandchildren
      for (const grandDep of dependentsMap[dep] ?? []) {
        setValue(grandDep, '');
        onChange(grandDep, '');
      }
    }
  }, [dependentsMap, setValue, onChange]);

  // Sync form values when values, section, or frameworkTerms change.
  // frameworkTerms is included so the reset fires once terms arrive — the
  // select can only show a saved value after its option list is populated,
  // AND so switching frameworks re-syncs against the now-adapted field set.
  // adaptedFields is a NEW array/object graph every render whenever a caller
  // passes an inline-built `fields` prop (e.g. `questionFormConfig.map(...)`
  // or `withLicenseOptions(...)`, both re-invoked on every parent render) —
  // depending on it by reference reruns this effect every render even when
  // its content is unchanged. reset()+trigger() then call onValidityChange,
  // which can change parent state, causing the parent (and this unstable
  // fields prop) to re-render again — an infinite render loop (React error
  // #185). Depend on content instead, same as `values` just above.
  const adaptedFieldsKey = JSON.stringify(adaptedFields);
  useEffect(() => {
    reset(buildDefaultValues(adaptedFields, values, section, showAllSections));
    void trigger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values), section, showAllSections, frameworkTerms, adaptedFieldsKey]);

  // Notify parent of validity changes
  useEffect(() => {
    onValidityChange?.(isValid);
  }, [isValid, onValidityChange]);

  if (visibleFields.length === 0) {
    return (
      <p className={styles.emptyMessage}>
        No fields available for this section.
      </p>
    );
  }

  return (
    <form
      className={styles.form}
      noValidate
      aria-label="Metadata form"
      onSubmit={(e) => e.preventDefault()}
    >
      {visibleFields.map((field) => {
        const fieldId = `smf-${field.code}`;
        const error = errors[field.code];
        const isDisabled = readOnly || !field.editable;
        const validator = makeFieldValidator(field);

        // showTimer: separator above, keeps its own full row
        const isShowTimer = field.code === 'showTimer';

        // Full-width: textarea, richtext, keywords/chips, time, appIcon.
        // Checkboxes flow two per row in the grid.
        const isFullWidth = ['textarea', 'richtext', 'keywords', 'time', 'appIcon'].includes(field.inputType ?? '')
          || field.span === 'full'
          || isShowTimer
          // Count select takes its own row — only the behaviour checkboxes
          // (shuffle/feedback/solution/hint) flow two per row.
          || field.code === 'maxQuestions';
        const fieldClass = [styles.field, isFullWidth ? styles.fieldFull : ''].filter(Boolean).join(' ');
        // Checkboxes (and showTimer's custom row) carry their label inline —
        // a separate uppercase header would duplicate it.
        const hideLabel = isShowTimer || field.inputType === 'checkbox';

        return (
          <div key={field.code} className={fieldClass}>
            {isShowTimer && (
              <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--sb-border)', margin: '8px 0 4px' }} />
            )}
            {!hideLabel && (
            <label className={styles.label} htmlFor={fieldId}>
              {field.label}
              {field.required && (
                <span className={styles.required} aria-label="required">
                  {' '}*
                </span>
              )}
            </label>
            )}

            {/* Field control */}
            <Controller
              name={field.code}
              control={control}
              rules={{ validate: validator }}
              render={({ field: rhfField }) => {
                const inputType = isMultiSelectField(field) ? 'multiselect' : (field.inputType ?? 'text');

                // ── richtext — renders HTML content via ContentEditable ───
                if (inputType === 'richtext') {
                  return (
                    <ContentEditable
                      value={String(rhfField.value ?? '')}
                      onChange={(html) => { rhfField.onChange(html); onChange(field.code, html); }}
                      placeholder={field.placeholder ?? ''}
                      disabled={isDisabled}
                      minHeight={90}
                      bodyClass="stem-field"
                    />
                  );
                }

                // ── textarea ──────────────────────────────────────────────
                if (inputType === 'textarea') {
                  return (
                    <textarea
                      id={fieldId}
                      className={`${styles.textarea} ${error ? styles.inputError : ''}`}
                      value={String(rhfField.value ?? '')}
                      onChange={(e) => {
                        rhfField.onChange(e.target.value);
                        onChange(field.code, e.target.value);
                      }}
                      onBlur={rhfField.onBlur}
                      disabled={isDisabled}
                      readOnly={readOnly}
                      placeholder={field.placeholder ?? ''}
                      maxLength={field.maxLength}
                      rows={4}
                      aria-invalid={!!error}
                      aria-describedby={error ? `${fieldId}-error` : undefined}
                    />
                  );
                }

                // ── select (single) ───────────────────────────────────────
                if (inputType === 'select') {
                  // The framework field's own options are the CHANNEL's
                  // available frameworks (channelData.frameworks) — never
                  // frameworkTerms, which only exists once a framework is
                  // already selected (that would be circular).
                  const options = field.code === 'framework'
                    ? channelFrameworks.map((fw) => ({ value: fw.identifier, label: fw.name }))
                    // Use cascaded options when field has depends[] — filters by
                    // parent term's associations (board→medium→gradeLevel→subject).
                    : buildCascadedOptions(field, frameworkTerms, watchedValues);
                  const currentVal = String(rhfField.value ?? '');
                  // Add saved value as a synthetic option when options aren't
                  // loaded yet (framework loading / API down).
                  const displayOptions =
                    currentVal && !options.find((o) => o.value === currentVal)
                      ? [{ value: currentVal, label: currentVal }, ...options]
                      : options;
                  return (
                    <SingleSelectDropdown
                      fieldId={fieldId}
                      value={currentVal}
                      options={displayOptions}
                      disabled={isDisabled}
                      hasError={!!error}
                      placeholder={field.placeholder ?? `Select ${field.label}`}
                      onChange={(raw) => {
                        // Coerce to a number for maxQuestions specifically,
                        // so the saved metadata sends a digit, not a string.
                        const newVal = field.code === 'maxQuestions' && raw !== '' ? Number(raw) : raw;
                        rhfField.onChange(newVal);
                        onChange(field.code, newVal);
                        // Reset all fields that depend on this one
                        resetDependents(field.code);
                      }}
                    />
                  );
                }

                // ── multiselect — searchable dropdown, multiple selections ─
                if (inputType === 'multiselect') {
                  const options = buildOptions(field, frameworkTerms);
                  const currentVal = Array.isArray(rhfField.value) ? (rhfField.value as string[]) : [];

                  return (
                    <MultiSelectSearch
                      fieldId={fieldId}
                      value={currentVal}
                      options={options}
                      readOnly={isDisabled}
                      hasError={!!error}
                      placeholder={field.placeholder ?? `Search ${field.label}…`}
                      onChange={(val) => {
                        rhfField.onChange(val);
                        onChange(field.code, val);
                      }}
                    />
                  );
                }

                // ── checkbox ──────────────────────────────────────────────
                if (inputType === 'checkbox') {
                  return (
                    <div className={styles.checkboxRow}>
                      <input
                        id={fieldId}
                        type="checkbox"
                        className={styles.checkbox}
                        checked={Boolean(rhfField.value)}
                        onChange={(e) => {
                          rhfField.onChange(e.target.checked);
                          onChange(field.code, e.target.checked);
                        }}
                        onBlur={rhfField.onBlur}
                        disabled={isDisabled}
                        aria-invalid={!!error}
                        aria-describedby={error ? `${fieldId}-error` : undefined}
                      />
                      <label htmlFor={fieldId} className={styles.checkboxLabel}
                        style={isShowTimer ? { fontWeight: 700, fontSize: 15 } : undefined}>
                        {field.label ?? field.placeholder ?? ''}
                      </label>
                    </div>
                  );
                }

                // ── date ──────────────────────────────────────────────────
                if (inputType === 'date') {
                  return (
                    <input
                      id={fieldId}
                      type="date"
                      className={`${styles.input} ${error ? styles.inputError : ''}`}
                      value={String(rhfField.value ?? '')}
                      onChange={(e) => {
                        rhfField.onChange(e.target.value);
                        onChange(field.code, e.target.value);
                      }}
                      onBlur={rhfField.onBlur}
                      disabled={isDisabled}
                      readOnly={readOnly}
                      aria-invalid={!!error}
                      aria-describedby={error ? `${fieldId}-error` : undefined}
                    />
                  );
                }

                // ── keywords (comma-separated with chips) ─────────────────
                if (inputType === 'keywords') {
                  const currentVal = Array.isArray(rhfField.value)
                    ? (rhfField.value as string[])
                    : [];
                  return (
                    <KeywordChips
                      fieldId={fieldId}
                      value={currentVal}
                      onChange={(next) => {
                        rhfField.onChange(next);
                        onChange(field.code, next);
                      }}
                      readOnly={isDisabled}
                      placeholder={field.placeholder}
                    />
                  );
                }

                // ── timer — HH : mm split inputs ─────────────────────────
                if (inputType === 'timepicker' || inputType === 'timer' || field.code === 'maxTime' || field.code === 'warningTime') {
                  return (
                    <TimerHmsField
                      seconds={Number(rhfField.value) || 0}
                      disabled={isDisabled}
                      onCommit={(secs) => { rhfField.onChange(secs); onChange(field.code, secs); }}
                      onBlur={rhfField.onBlur}
                    />
                  );
                }

                // ── appIcon — clickable image thumbnail picker ────────────
                if (inputType === 'appIcon') {
                  return (
                    <AppIconPicker
                      value={String(rhfField.value ?? '')}
                      disabled={isDisabled}
                      onChange={(url) => { rhfField.onChange(url); onChange(field.code, url); }}
                    />
                  );
                }

                // ── text (default / unknown inputType fallback) ────────────
                return (
                  <input
                    id={fieldId}
                    type="text"
                    className={`${styles.input} ${error ? styles.inputError : ''}`}
                    value={String(rhfField.value ?? '')}
                    onChange={(e) => {
                      rhfField.onChange(e.target.value);
                      onChange(field.code, e.target.value);
                    }}
                    onBlur={rhfField.onBlur}
                    disabled={isDisabled}
                    readOnly={readOnly}
                    placeholder={field.placeholder ?? ''}
                    maxLength={field.maxLength}
                    aria-invalid={!!error}
                    aria-describedby={error ? `${fieldId}-error` : undefined}
                  />
                );
              }}
            />

            {/* Validation error message */}
            {error && (
              <span
                id={`${fieldId}-error`}
                className={styles.error}
                role="alert"
                aria-live="polite"
              >
                {String((error as { message?: string }).message ?? 'Invalid value')}
              </span>
            )}
          </div>
        );
      })}
    </form>
  );
};

export default SparkMetaForm;
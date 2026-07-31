import React, { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as genUuid } from 'uuid';
import { Icon } from '../shared/Icon';
import { useLibrary } from '../../hooks/useLibrary';
import { useTreeStore } from '../../store/tree.store';
import { useEditorStore } from '../../store/editor.store';
import { useCopyRegistryStore } from '../../store/copyRegistry.store';
import { useLabels } from '../../hooks/useLabels';
import { addQuestionsToSet } from '../../api/hierarchy';
import { readQuestion, createQuestion, publishQuestion } from '../../api/question';
import { detectNodeKind } from '../../utils/nodeKind';
import { resolveByCategory } from '../../registry';
import type { IContent } from '../../types/content';
import { QUESTION_FILTERS } from '../../types/content';

// =============================================================================
// Helpers
// =============================================================================

/** Short type-badge text (e.g. "MCQ") from a primaryCategory string. */
function typeBadge(primaryCategory?: string): string {
  const cat = (primaryCategory ?? '').toLowerCase();
  if (cat.includes('multiple choice')) return 'MCQ';
  if (cat.includes('subjective')) return 'SA';
  if (cat.includes('fill in') || cat.includes('ftb')) return 'FTB';
  if (cat.includes('match')) return 'MTF';
  if (cat.includes('sequence')) return 'SEQ';
  if (cat.includes('reorder')) return 'REO';
  if (cat.includes('boolean')) return 'BOOL';
  return 'Q';
}

/** Same per-type icon the "Create Question" type picker uses (registry). */
function typeIcon(primaryCategory?: string): string {
  return resolveByCategory(primaryCategory)?.icon ?? 'help';
}

/** "Science · Class 7" caption from subject/gradeLevel arrays. */
function metaLine(item: IContent): string {
  const subject = item.subject?.[0];
  const grade = item.gradeLevel?.[0];
  return [subject, grade].filter(Boolean).join(' · ');
}

// =============================================================================
// Toast — lightweight ephemeral notification
// =============================================================================

interface ToastMessage {
  id: number;
  text: string;
  kind: 'success' | 'error';
}

let toastIdCounter = 0;

function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const show = useCallback((text: string, kind: 'success' | 'error' = 'success') => {
    const id = ++toastIdCounter;
    setToasts((prev) => [...prev, { id, text, kind }]);
    timersRef.current.push(
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2800),
    );
  }, []);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  return { toasts, show };
}

// =============================================================================
// LibraryDock
// =============================================================================

interface LibraryDockProps {
  onCollapse: () => void;
}

export function LibraryDock({ onCollapse }: LibraryDockProps) {
  const L = useLabels();
  const { content, isLoading, activeFilter, searchQuery, sortAZ, hasMore, search, setFilter, toggleSort, loadMore } =
    useLibrary();

  const selectedNodeId = useTreeStore((s) => s.selectedNodeId);
  const addExistingQuestion = useTreeStore((s) => s.addExistingQuestion);
  const getNodeById = useTreeStore((s) => s.getNodeById);
  const updateNode = useTreeStore((s) => s.updateNode);
  const editorMode = useEditorStore((s) => s.editorMode);
  const isReadOnly = editorMode !== 'edit';

  const { toasts, show: showToast } = useToast();

  // Per-item in-flight guard — canAddExistingQuestion only reads the local
  // tree, which isn't updated with the new node until handleAdd's await
  // resolves, so a fast double-click on the same row could otherwise fire
  // two questionset/v2/add calls before the first one lands.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  // Type filter chips are hidden behind this toggle instead of always
  // taking up space in the sidebar.
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [inputValue, setInputValue] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInputValue(val);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => search(val), 300);
    },
    [search],
  );

  const handleClearSearch = useCallback(() => {
    setInputValue('');
    search('');
  }, [search]);

  // Same single-question preview QuestionEditor's own "Preview" button uses
  // (QumlPlayer via the global showPreview/previewQuestionId flag) — works
  // for a library question even though it isn't part of the open
  // questionset's tree; QumlPlayer falls back to fetching it directly.
  const handlePreview = useCallback((item: IContent) => {
    useEditorStore.getState().setShowPreview(true, item.identifier);
  }, []);

  const handleAdd = useCallback(
    async (item: IContent) => {
      if (pendingIds.has(item.identifier)) return;

      // A question can only be attached to a section — never directly under
      // the questionset root (questionset/v2/add requires collectionId to
      // be an existing section child of root, not the root itself). isFolder
      // is true for BOTH root and section, so it can't distinguish them —
      // use detectNodeKind instead.
      let targetId: string | null = selectedNodeId;
      if (targetId) {
        const node = getNodeById(targetId);
        const kind = node ? detectNodeKind(node) : null;
        if (kind === 'question') targetId = node!.parent ?? null;
        else if (kind === 'root') targetId = null;
      }
      if (!targetId) {
        showToast(L('messages.error.selectSection', 'Select a section to add the question to'), 'error');
        return;
      }

      // The section itself must exist on the backend before anything can be
      // attached to it — questionset/v2/add needs a real collectionId.
      // Refuse up front rather than staging the question locally with
      // nothing to actually attach it to; that only ever looked "added"
      // without ever getting persisted unless the user happened to reopen
      // this exact question later (which is what retried the attach).
      if (targetId.startsWith('temp-')) {
        showToast(
          L('messages.error.sectionNotSaved', 'Save this section before adding questions to it'),
          'error',
        );
        return;
      }

      // Validate BEFORE calling the attach API or touching the tree at all —
      // nothing should appear in the outline, even briefly, until the
      // backend has actually confirmed the attach. (Inserting optimistically
      // and rolling back on failure works, but flashes the question into
      // the tree for the duration of the network call.)
      const check = useTreeStore.getState().canAddExistingQuestion(targetId, item.identifier);
      if (check === 'exists') {
        showToast(L('messages.error.alreadyInSet', 'This question is already in the set'), 'error');
        return;
      }
      if (check === 'maxDepth') {
        showToast(L('messages.error.maxDepth', 'Cannot add here — maximum depth reached'), 'error');
        return;
      }

      const displayName = (item.name ?? 'Question').slice(0, 40);

      setPendingIds((prev) => new Set(prev).add(item.identifier));
      try {
        // Standalone (Default-visibility) questions must be attached via
        // questionset/v2/add before they exist in this section at all.
        const rootId = useTreeStore.getState().treeData[0]?.identifier;
        try {
          if (!rootId) throw new Error('No root questionset id');
          await addQuestionsToSet(rootId, targetId, [item.identifier]);
        } catch (err) {
          console.error('[LibraryDock] attach failed:', err);
          showToast(L('messages.error.attachFailed', 'Could not add this question — please try again'), 'error');
          return;
        }

        // Attach confirmed — now link it into the local tree (old-editor
        // semantics — nothing new is created, the do_ id joins as-is).
        const result = addExistingQuestion(targetId, item as unknown as { identifier: string } & Record<string, unknown>);
        updateNode(result, { visibility: 'Default' });
        // {NAME} is a substitution placeholder, not literal text — label()
        // has no interpolation of its own, so both the config value and
        // this fallback use the same placeholder and get it swapped in here.
        showToast(L('messages.success.questionAdded', '"{NAME}" added').replace('{NAME}', displayName), 'success');
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(item.identifier);
          return next;
        });
      }
    },
    [pendingIds, selectedNodeId, getNodeById, addExistingQuestion, updateNode, showToast, L],
  );

  // Creates an independent copy of a Library question (own do_ id,
  // visibility: "Default" — same create+publish+attach mechanism as
  // "Create Question"/"+" Add, so its future edits stay genuinely
  // isolated), then attaches ONLY that copy to the current section. The
  // copy registry (copyRegistry.store.ts) marks it so it never resurfaces
  // in Library search and so QuestionDetail knows to offer "Open in
  // editor" for it — a plain "+" Add-ed (reference) question never does.
  const handleCopy = useCallback(
    async (item: IContent) => {
      if (pendingIds.has(item.identifier)) return;

      // Same target-section resolution as handleAdd — a copy also needs a
      // real section to live in, never the questionset root directly.
      let targetId: string | null = selectedNodeId;
      if (targetId) {
        const node = getNodeById(targetId);
        const kind = node ? detectNodeKind(node) : null;
        if (kind === 'question') targetId = node!.parent ?? null;
        else if (kind === 'root') targetId = null;
      }
      if (!targetId) {
        showToast(L('messages.error.selectSection', 'Select a section to add the question to'), 'error');
        return;
      }
      if (targetId.startsWith('temp-')) {
        showToast(
          L('messages.error.sectionNotSaved', 'Save this section before adding questions to it'),
          'error',
        );
        return;
      }
      // A copy is a brand-new identifier — no "already in the set" check
      // like handleAdd's; only depth can block it.
      if (useTreeStore.getState().isMaxDepth(targetId)) {
        showToast(L('messages.error.maxDepth', 'Cannot add here — maximum depth reached'), 'error');
        return;
      }

      const displayName = (item.name ?? 'Question').slice(0, 40);

      setPendingIds((prev) => new Set(prev).add(item.identifier));
      try {
        const raw = await readQuestion(item.identifier);
        // Strip fields that describe the SOURCE object specifically — a
        // fresh copy has none of these yet (schemaVersion is also
        // backend-managed and rejected on create, same as "Create Question").
        const {
          identifier: _srcId, code: _srcCode, versionKey: _srcVersionKey,
          status: _srcStatus, createdOn: _srcCreatedOn, lastUpdatedOn: _srcLastUpdatedOn,
          lastStatusChangedOn: _srcLastStatusChangedOn, schemaVersion: _srcSchemaVersion,
          ...sourceContent
        } = raw;
        const rootMeta = (useTreeStore.getState().treeData[0]?.metadata ?? {}) as Record<string, unknown>;
        const createMeta: Record<string, unknown> = {
          ...sourceContent,
          code: genUuid(),
          visibility: 'Default',
          ...(rootMeta.qumlVersion !== undefined ? { qumlVersion: rootMeta.qumlVersion } : {}),
        };

        const { identifier: newId } = await createQuestion(createMeta);

        // Mark it as a copy immediately, before anything that can still
        // fail below — the question already exists on the backend at this
        // point regardless of whether publish/attach succeed, so it must
        // never be left untracked (visible in search, un-editable, with no
        // way to identify it as a copy again).
        useCopyRegistryStore.getState().markAsCopy(newId);

        // Publish immediately — matches "Create Question": non-fatal if it
        // fails, but the copy stays a Draft until something republishes it.
        let published = true;
        try {
          await publishQuestion(newId);
        } catch (publishErr) {
          published = false;
          console.error('[LibraryDock] copy publish failed, stays Draft:', publishErr);
        }

        try {
          const rootId = useTreeStore.getState().treeData[0]?.identifier;
          if (!rootId) throw new Error('No root questionset id');
          await addQuestionsToSet(rootId, targetId, [newId]);
        } catch (err) {
          console.error('[LibraryDock] copy attach failed:', err);
          showToast(L('messages.error.attachFailed', 'Could not add this question — please try again'), 'error');
          return;
        }

        // Re-read the just-created (and possibly just-published) question —
        // publish bumps versionKey, and createMeta never had one to begin
        // with. Without this, the node's versionKey stays blank until
        // useQuestionRead's own auto-fetch resolves (it fires once this
        // copy is selected below), which the user can easily race past by
        // opening it for editing and saving right away — a guaranteed
        // BLANK_VERSION on that first save, self-healed by useSaveQuestion's
        // stale-versionKey retry, but a wasted round-trip every time. Retry
        // once — a transient failure here would otherwise silently drop
        // back to a versionKey-less createMeta and reproduce that race.
        let finalMeta: Record<string, unknown> = createMeta;
        try {
          finalMeta = await readQuestion(newId);
        } catch (readErr) {
          console.error('[LibraryDock] copy re-read failed, retrying once:', readErr);
          try {
            finalMeta = await readQuestion(newId);
          } catch (retryErr) {
            console.error('[LibraryDock] copy re-read retry also failed, using local metadata:', retryErr);
          }
        }

        const resultId = addExistingQuestion(targetId, { ...finalMeta, identifier: newId });
        updateNode(resultId, { visibility: 'Default' });

        if (published) {
          showToast(L('messages.success.questionCopied', '"{NAME}" copied').replace('{NAME}', displayName), 'success');
        } else {
          showToast(
            L('messages.error.copyPublishFailed', 'Copied, but could not be published — it stays a Draft.'),
            'error',
          );
        }
      } catch (err) {
        console.error('[LibraryDock] copy failed:', err);
        showToast(L('messages.error.copyFailed', 'Could not copy this question — please try again'), 'error');
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(item.identifier);
          return next;
        });
      }
    },
    [pendingIds, selectedNodeId, getNodeById, addExistingQuestion, updateNode, showToast, L],
  );

  return (
    <>
      <div className="ce-lib-head">
        <Icon name="library" size={18} className="ico" />
        <span className="lbl">{L('ui.questionLibrary', 'Question Library')}</span>
        <button
          title={L('ui.collapse', 'Collapse')}
          onClick={onCollapse}
          aria-label={L('ui.collapseLibraryPanel', 'Collapse library panel')}
        >
          <Icon name="panel-right" size={17} />
        </button>
      </div>

      <div className="ce-lib-search">
        <div className="ce-lib-search-box">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder={L('ui.searchLibrary', 'Search library…')}
            value={inputValue}
            onChange={handleSearchChange}
            aria-label={L('ui.searchLibrary', 'Search library')}
          />
          {inputValue && (
            <button
              type="button"
              className="ce-lib-search-clear"
              onClick={handleClearSearch}
              aria-label={L('ui.clearSearch', 'Clear search')}
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
        <button
          type="button"
          className="ce-lib-sort"
          onClick={toggleSort}
          aria-pressed={sortAZ}
          title={sortAZ ? L('ui.sortByRecent', 'Switch to most recent first') : L('ui.sortAZ', 'Sort A–Z')}
          aria-label={sortAZ ? L('ui.sortByRecent', 'Switch to most recent first') : L('ui.sortAZ', 'Sort A–Z')}
        >
          {sortAZ ? <span>{L('ui.sortAZLabel', 'A–Z')}</span> : <Icon name="clock" size={15} />}
        </button>
        <button
          type="button"
          className={`ce-lib-filter-btn${filtersOpen ? ' on' : ''}`}
          onClick={() => setFiltersOpen((open) => !open)}
          aria-pressed={filtersOpen}
          aria-expanded={filtersOpen}
          title={L('ui.filterByQuestionType', 'Filter by question type')}
          aria-label={L('ui.filterByQuestionType', 'Filter by question type')}
        >
          <Icon name="sliders" size={16} />
        </button>
      </div>

      {filtersOpen && (
        <div className="ce-lib-filters" aria-label={L('ui.filterByQuestionType', 'Filter by question type')}>
          {QUESTION_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`ce-lib-chip${activeFilter === f.value ? ' on' : ''}`}
              onClick={() => setFilter(f.value)}
              aria-pressed={activeFilter === f.value}
            >
              {L(f.labelKey, f.label)}
            </button>
          ))}
        </div>
      )}

      <div className="ce-lib-scroll" role="list" aria-label={L('ui.questionList', 'Question list')}>
        {isLoading && content.length === 0 ? (
          <div className="ce-lib-loading" role="status">
            <span className="ce-spinner" style={{ width: 22, height: 22, borderWidth: 2 }} aria-hidden="true" />
            <span>{L('ui.loadingQuestions', 'Loading questions…')}</span>
          </div>
        ) : content.length === 0 ? (
          <p className="ce-lib-empty">
            {L('ui.noQuestionsFound', 'No questions found. Try a different search.')}
          </p>
        ) : (
          <>
            {content.map((item) => (
              <div
                key={item.identifier}
                className="ce-lib-item"
                role="listitem"
                tabIndex={0}
                onClick={() => handlePreview(item)}
                onKeyDown={(e) => {
                  // Enter/Space bubbles here from the nested "+" button too
                  // (before its own native click activation fires) — only
                  // treat it as "preview the row" when the row itself is the
                  // actual target, so a keyboard user tabbed to the add
                  // button can still activate it instead of always previewing.
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePreview(item); }
                }}
                title={L('ui.previewThisQuestion', 'Preview this question')}
                aria-label={`${L('ui.previewThisQuestion', 'Preview this question')}: ${item.name}`}
              >
                <span className="ico"><Icon name={typeIcon(item.primaryCategory)} size={15} /></span>
                <div className="body">
                  <p className="nm">{item.name || L('ui.untitledQuestion', 'Untitled Question')}</p>
                  <div className="meta">
                    <span className="type-pill">{typeBadge(item.primaryCategory)}</span>
                    {metaLine(item) && <span className="sub">{metaLine(item)}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  className="copy-btn"
                  disabled={isReadOnly || pendingIds.has(item.identifier)}
                  onClick={(e) => { e.stopPropagation(); void handleCopy(item); }}
                  title={L('ui.copyQuestion', 'Copy to this section')}
                  aria-label={`${L('ui.copyQuestion', 'Copy to this section')}: ${item.name}`}
                >
                  <Icon name="copy" size={13} />
                </button>
                <button
                  type="button"
                  className="add-btn"
                  disabled={isReadOnly || pendingIds.has(item.identifier)}
                  onClick={(e) => { e.stopPropagation(); void handleAdd(item); }}
                  title={L('ui.addToQuestionSet', 'Add to question set')}
                  aria-label={`${L('ui.addToQuestionSet', 'Add to question set')}: ${item.name}`}
                >
                  <Icon name="plus" size={13} />
                </button>
              </div>
            ))}

            {hasMore && (
              <button
                type="button"
                className="ce-lib-loadmore"
                onClick={loadMore}
                disabled={isLoading}
                aria-label={L('ui.loadMoreQuestions', 'Load more questions')}
              >
                {isLoading ? L('ui.loading', 'Loading…') : L('ui.loadMore', 'Load more')}
              </button>
            )}
          </>
        )}
      </div>

      {toasts.length > 0 && (
        <div className="ce-lib-toast" aria-live="assertive" aria-atomic="true">
          {toasts.map((t) => (
            <div key={t.id} className={`t ${t.kind}`} role="alert">
              {t.text}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default LibraryDock;

import React, { useState, useEffect, useCallback } from 'react';
import { EditorRootContext } from '../shared/EditorRootContext';
import type { IEditorEvents, ToolbarAction } from '../../types/editor';
import { useTreeStore } from '../../store/tree.store';
import { useEditorStore } from '../../store/editor.store';
import { useSaveHierarchy } from '../../hooks/useSaveHierarchy';
import { useValidateAndSave } from '../../hooks/useValidateAndSave';
import { useToolbarActions } from '../../hooks/useToolbarActions';
import { Topbar } from '../Topbar/Topbar';
import OutlineTree from '../OutlineTree/OutlineTree';
import LibraryDock from '../LibraryDock/LibraryDock';
import { useUiStore } from '../../store/ui.store';
import { notifyError, notifySuccess } from '../../utils/notify';
import { label } from '../../utils/labels';
import { telemetryInteract } from '../../utils/telemetry';
import ContextualEditor from '../ContextualEditor/ContextualEditor';
import UnsavedChangesModal from '../modals/UnsavedChangesModal';
import MissingRequiredFieldsModal from '../modals/MissingRequiredFieldsModal';
import { QuestionTypeSelectorModal } from '../modals/QuestionTypeSelectorModal';
import { ConnectedConfirmDialog } from '../modals/ConfirmDialog';
import { getContentId } from '../../utils/context';
import { useIsDynamicAssess } from '../../hooks/useIsDynamicAssess';
import { readHierarchy } from '../../api/hierarchy';
import { GeneratingOverlay } from '../shared/GeneratingOverlay';
import { StaleSettingsBanner } from '../shared/StaleSettingsBanner';
import { isGenerationStale, needsGeneration } from '../../utils/dynamicAssessDraw';
import { useDynamicSkillField } from '../../hooks/useDynamicSkillField';
import { useRefreshQuestionSetBody, sessionCancelledCheck } from '../../hooks/useRefreshQuestionSetBody';

interface SplitEditorShellProps {
  events: IEditorEvents;
}

export function SplitEditorShell({ events }: SplitEditorShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const [isFormValid, setIsFormValid] = useState(true);
  const [pendingBack, setPendingBack] = useState(false);
  const missingFieldGroups = useUiStore((s) => s.missingFieldGroups);
  const setMissingFieldGroups = useUiStore((s) => s.setMissingFieldGroups);

  const isDirty = useEditorStore((s) => s.isDirty);
  const editorMode = useEditorStore((s) => s.editorMode);
  const lastSaved = useEditorStore((s) => s.lastSaved);
  const isDynamicAssess = useIsDynamicAssess();
  const isGenerating = useEditorStore((s) => s.buttonLoaders.refreshBody);
  const generationPending = useEditorStore((s) => s.buttonLoaders.refreshPending);
  const skillField = useDynamicSkillField();
  // Matches when Topbar shows the Generate button to a reviewer.
  const canReviewerRegenerate = useEditorStore((s) => (s.editorMode === 'orgreview' || s.editorMode === 'sourcingreview') && !!s.editorConfig?.context?.enableReviewEdit);
  // Saved settings only: unsaved edits are already signalled by Save turning into "Save & Generate".
  const savedSettingsStale = useTreeStore((s) => isDynamicAssess && isGenerationStale(s.treeData[0], {}, 'Dynamic QuestionSet', skillField));

  const { save, isSaving } = useSaveHierarchy();
  const { refresh: regenerate } = useRefreshQuestionSetBody();
  const validateAndSave = useValidateAndSave();
  const { runAction } = useToolbarActions(validateAndSave);

  // A save while questions generate, or after a timed-out generation that may still be writing, would put the old questions back over the job's result.
  const generationBlocksSave = useCallback(() => {
    const { refreshBody, refreshPending } = useEditorStore.getState().buttonLoaders;
    return isDynamicAssess && (refreshBody || refreshPending);
  }, [isDynamicAssess]);
  const notifyGenerationBlocksSave = () =>
    notifyError(label('messages.error.dynamicAssessPendingSave', 'Questions are still being generated. Reopen this question set before saving.'));

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  const handleToolbarEvent = useCallback(
    async (event: {
      action: ToolbarAction;
      data?: unknown;
      // Internal-only — callers that need a richer old-editor id/subtype/extra
      // (distinct from the raw action name) pass it here instead of calling
      // telemetryInteract themselves, so there is exactly one INTERACT per
      // click, never two. NOT part of the host-facing event contract below.
      telemetry?: { id: string; subtype?: string; extra?: Record<string, unknown> };
    }) => {
      const { action, data, telemetry } = event;
      // 'back' with unsaved changes is NOT forwarded yet — the host would
      // navigate away before the prompt shows; it's emitted once the prompt
      // resolves (save/discard handlers below). telemetry is stripped —
      // internal plumbing, not part of the public {action, data} contract.
      if (!(action === 'back' && isDirty)) events.onToolbarEvent?.({ action, data });
      // Old editor logs an INTERACT per toolbar action.
      if (!['onFormValueChange', 'onFormStatusChange'].includes(action)) {
        if (telemetry) {
          telemetryInteract(telemetry.id, { subtype: telemetry.subtype, extra: telemetry.extra });
        } else {
          telemetryInteract(action);
        }
      }

      switch (action) {
        case 'onFormStatusChange': {
          const valid = (data as { isValid?: boolean } | undefined)?.isValid ?? true;
          setIsFormValid(valid);
          break;
        }
        case 'back': {
          if (isDirty) { setPendingBack(true); setShowUnsavedPrompt(true); }
          break;
        }
        case 'preview': {
          const { showPreview, setShowPreview } = useEditorStore.getState();
          if (showPreview) { setShowPreview(false); break; }
          // Old editor saves before previewing in edit mode; not while a Dynamic generation is running or may be mid-write.
          if (editorMode === 'edit' && generationBlocksSave()) { notifyGenerationBlocksSave(); break; }
          if (editorMode === 'edit' && (await save()) === false) break;
          setShowPreview(true);
          break;
        }
        case 'saveContent': {
          // Dynamic sets generate as part of Save, but only when Skill/Target need it; any other edit is a plain save.
          const { treeData, treeCache } = useTreeStore.getState();
          if (generationBlocksSave()) { notifyGenerationBlocksSave(); break; }
          if (isDynamicAssess && needsGeneration(treeData[0], treeCache, 'Dynamic QuestionSet', skillField)) {
            await regenerate({ saveIfBlocked: true });
            break;
          }
          // Captured before the save, so a reload that lands after this editor closed can't replace another set's tree.
          const isCancelled = sessionCancelledCheck();
          if (await validateAndSave()) {
            notifySuccess(label('messages.success.001', 'Question set saved as draft'));
            // Reload so a Dynamic set's banner reflects the just-saved settings instead of the ones it was opened with.
            const contentId = getContentId(useEditorStore.getState().editorConfig?.context);
            if (isDynamicAssess && contentId && !isCancelled()) {
              readHierarchy(contentId).then(({ rootNode }) => { if (rootNode && !isCancelled()) useTreeStore.getState().setTreeData([rootNode]); }).catch(() => {});
            }
          }
          break;
        }
        case 'sendForReview':
        case 'reject':
        case 'publish': {
          // Old editor closes after a successful workflow action — emit
          // 'back' so the host navigates away (portal returns to workspace).
          if (await runAction(action, data)) {
            events.onToolbarEvent?.({ action: 'back' });
          }
          break;
        }
        default:
          break;
      }
    },
    [events, isDirty, save, runAction, editorMode, validateAndSave, isDynamicAssess, regenerate, skillField, generationBlocksSave],
  );

  const handleDiscardAndProceed = useCallback(() => {
    setShowUnsavedPrompt(false);
    if (pendingBack) { setPendingBack(false); events.onToolbarEvent?.({ action: 'back' }); }
  }, [pendingBack, events]);

  const handleSaveAndProceed = useCallback(async () => {
    // Stay in the editor rather than save over the job's write; Discard still leaves.
    if (generationBlocksSave()) {
      notifyGenerationBlocksSave();
      setShowUnsavedPrompt(false);
      setPendingBack(false);
      return;
    }
    await save();
    setShowUnsavedPrompt(false);
    if (pendingBack) { setPendingBack(false); events.onToolbarEvent?.({ action: 'back' }); }
  }, [save, pendingBack, events, generationBlocksSave]);

  const handleCancelUnsaved = useCallback(() => {
    setShowUnsavedPrompt(false);
    setPendingBack(false);
  }, []);

  const questionEditorOpen = useUiStore((s) => s.questionEditorOpen);
  const hasContent = useTreeStore((s) => s.treeData.length > 0);

  // Own root element — modals portal into THIS instance's .ce (multiple
  // editors can be mounted on one host page; a global querySelector would
  // always hit the first).
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null);

  return (
    <EditorRootContext.Provider value={rootEl}>
    <div className="ce" ref={setRootEl}>
      {/* Top bar */}
      <Topbar
        disabled={questionEditorOpen}
        editorMode={editorMode}
        isSaving={isSaving}
        isDirty={isDirty}
        lastSaved={lastSaved}
        isFormValid={isFormValid}
        onToolbarEvent={handleToolbarEvent}
      />

      {/* Three-pane body */}
      <div className="ce-body">
        {/* Reopen tab when tree is collapsed */}
        {sidebarCollapsed && !questionEditorOpen && (
          <button
            className="ce-reopen left"
            onClick={() => setSidebarCollapsed(false)}
            title="Show hierarchy"
            aria-label="Show hierarchy panel"
          >
            ›
          </button>
        )}

        {/* Left — Outline tree */}
        {/* Hierarchy is closed + locked while a question is being edited */}
        <aside
          className={`ce-tree${sidebarCollapsed || questionEditorOpen ? ' collapsed' : ''}`}
          style={questionEditorOpen ? { pointerEvents: 'none' } : undefined}
          aria-disabled={questionEditorOpen || undefined}
        >
          <OutlineTree onCollapse={() => setSidebarCollapsed(true)} />
        </aside>

        {/* Center — Contextual editor */}
        <main className="ce-main">
          <StaleSettingsBanner open={(savedSettingsStale || generationPending) && !isGenerating} pending={generationPending} canRegenerate={editorMode === 'edit' || canReviewerRegenerate} />
          <ContextualEditor
            hasContent={hasContent}
            onToolbarEvent={handleToolbarEvent}
          />
        </main>

        {/* Right — Question library */}
        {/* Locked while a question is being edited, like the left hierarchy.
            Hidden for Dynamic Assess sets — their children are auto-selected
            from a pool via "Generate Questions", not manually curated. */}
        {editorMode === 'edit' && !isDynamicAssess && (
          <>
            <aside
              className={`ce-lib${libraryCollapsed || questionEditorOpen ? ' collapsed' : ''}`}
              style={questionEditorOpen ? { pointerEvents: 'none' } : undefined}
              aria-disabled={questionEditorOpen || undefined}
            >
              <LibraryDock onCollapse={() => setLibraryCollapsed(true)} />
            </aside>

            {/* Reopen tab when library is collapsed */}
            {libraryCollapsed && !questionEditorOpen && (
              <button
                className="ce-reopen right"
                onClick={() => setLibraryCollapsed(false)}
                title="Show question library"
                aria-label="Show question library panel"
              >
                ‹
              </button>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {showUnsavedPrompt && (
        <UnsavedChangesModal
          onDiscard={handleDiscardAndProceed}
          onSave={handleSaveAndProceed}
          onCancel={handleCancelUnsaved}
          isSaving={isSaving}
        />
      )}
      {missingFieldGroups && (
        <MissingRequiredFieldsModal
          groups={missingFieldGroups}
          onClose={() => setMissingFieldGroups(null)}
        />
      )}
      <QuestionTypeSelectorModal />
      <ConnectedConfirmDialog />
      <GeneratingOverlay open={isDynamicAssess && isGenerating} />
    </div>
    </EditorRootContext.Provider>
  );
}

export default SplitEditorShell;
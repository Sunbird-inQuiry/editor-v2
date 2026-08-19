import React, { useState, useCallback } from 'react';
import { Icon } from '../shared/Icon';
import { useLabels } from '../../hooks/useLabels';
import { useTreeStore } from '../../store/tree.store';
import { useEditorStore } from '../../store/editor.store';
import { useUiStore } from '../../store/ui.store';
import { useValidateAndSave } from '../../hooks/useValidateAndSave';
import type { INode } from '../../types/editor';
import { resolveQuestionType } from '../../registry';
import { detectNodeKind } from '../../utils/nodeKind';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OutlineTreeProps {
  onCollapse: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


function shortTypeLabel(questionType?: string): string {
  if (!questionType) return '';
  return resolveQuestionType(questionType)?.qType ?? questionType.toUpperCase();
}

function getStatusClass(status?: string): string {
  return (status ?? '').toLowerCase() === 'live' ? 'ready' : 'draft';
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

interface ContextMenuProps {
  isRoot: boolean;
  isQuestion: boolean;
  isEditMode: boolean;
  nodeId: string;
  onClose: () => void;
  onAddSection: () => void;
  onDelete: () => void;
  onPreview: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = (props) => {
  const L = useLabels();
  return <ContextMenuInner {...props} L={L} />;
};

const ContextMenuInner: React.FC<ContextMenuProps & { L: (p: string, f: string) => string }> = ({
  isRoot, isQuestion, isEditMode, onClose, onAddSection, onDelete, onPreview, L,
}) => {
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest('[data-ctxmenu]');
      if (!el) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      data-ctxmenu="true"
      style={{
        position: 'absolute', insetInlineEnd: 0, top: '100%', zIndex: 200,
        background: '#fff', border: '1px solid var(--sb-border)', borderRadius: 12,
        boxShadow: 'var(--sb-shadow-deep)', padding: 6, minWidth: 160,
      }}
    >
      {isQuestion && (
        <button
          style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 11px', border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, textAlign: 'left', color: 'var(--sb-text-2)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-soft)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          onClick={() => { onPreview(); onClose(); }}
        >
          <Icon name="play" size={13} /> {L('button_labels.preview_collection_btn_label', 'Preview')}
        </button>
      )}
      {isRoot && isEditMode && (
        <button
          style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 11px', border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, textAlign: 'left', color: 'var(--sb-text-2)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-soft)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          onClick={() => { onAddSection(); onClose(); }}
        >
          <Icon name="plus" size={13} /> {L('ui.addSection', 'Add Section')}
        </button>
      )}
      {!isRoot && isEditMode && (
        <button
          style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 11px', border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, textAlign: 'left', color: 'var(--sb-red)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--sb-red-soft)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          onClick={() => { onDelete(); onClose(); }}
        >
          <Icon name="trash" size={13} /> {L('button_labels.delete_btn_label', 'Delete')}
        </button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Recursive node renderer
// ---------------------------------------------------------------------------

interface NodeProps {
  node: INode;
  selectedId: string | null;
  openIds: Set<string>;
  contextMenuId: string | null;
  isEditMode: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onOpenCtx: (id: string) => void;
  onCloseCtx: () => void;
  onAddSection: (parentId: string) => void;
  onDelete: (id: string) => void;
  onPreview: (id: string) => void;
}

const TreeNode: React.FC<NodeProps> = ({
  node, selectedId, openIds, contextMenuId, isEditMode,
  onSelect, onToggle, onOpenCtx, onCloseCtx,
  onAddSection, onDelete, onPreview,
}) => {
  const L = useLabels();
  const kind = detectNodeKind(node);
  const isRoot = kind === 'root';
  const isSection = kind === 'section';
  const isQuestion = kind === 'question';
  const isSelected = node.id === selectedId;
  const isOpen = openIds.has(node.id);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isCtxOpen = contextMenuId === node.id;
  const canExpand = (isRoot || isSection) && hasChildren;

  const nodeType = isRoot ? 'set' : isSection ? 'section' : 'question';
  const className = `ce-node ${nodeType}${isSelected ? ' active' : ''}`;

  return (
    <>
      {/* div instead of button to allow nested buttons (context menu) */}
      <div
        className={className}
        onClick={() => { onSelect(node.id); if (canExpand) onToggle(node.id); }}
        aria-selected={isSelected}
        role="treeitem"
        tabIndex={0}
        aria-expanded={canExpand ? isOpen : undefined}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(node.id); if (canExpand) onToggle(node.id); } }}
      >
        {/* Expand / collapse twist */}
        <span
          className={`twist${canExpand ? (isOpen ? ' open' : ' closed') : ' leaf'}`}
          onClick={e => { e.stopPropagation(); if (canExpand) onToggle(node.id); }}
        >
          <Icon name="caret" size={13} />
        </span>

        {/* Icon — only for root and section, NOT for questions */}
        {isRoot && (
          <span className="ico">
            <Icon name="book" size={15} />
          </span>
        )}
        {isSection && (
          <span className="ico">
            <Icon name="folder" size={14} />
          </span>
        )}

        {/* Question type label (questions only) */}
        {isQuestion && (
          <span className="type">{shortTypeLabel(node.questionType ?? (node.metadata?.questionType as string))}</span>
        )}

        {/* Name */}
        <span className="nm">{node.name}</span>

        {/* Question count badge (sections only, not root) */}
        {isSection && (
          <span className="qbadge">{node.children?.length ?? 0}</span>
        )}


        {/* Context menu */}
        {isEditMode && (
          <div style={{ position: 'relative', marginLeft: isQuestion ? undefined : '2px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              style={{
                width: 26, height: 26, borderRadius: 7, border: 'none', background: 'transparent',
                cursor: 'pointer', display: 'grid', placeItems: 'center',
                color: 'var(--sb-text-faint)', opacity: isCtxOpen ? 1 : undefined,
              }}
              className="ce-ctx-btn"
              onClick={e => { e.stopPropagation(); isCtxOpen ? onCloseCtx() : onOpenCtx(node.id); }}
              aria-label={L('ui.nodeOptions', 'Node options')}
            >
              <Icon name="more" size={14} />
            </button>
            {isCtxOpen && (
              <ContextMenu
                isRoot={isRoot}
                isQuestion={isQuestion}
                isEditMode={isEditMode}
                nodeId={node.id}
                onClose={onCloseCtx}
                onAddSection={() => onAddSection(node.id)}
                onDelete={() => onDelete(node.id)}
                onPreview={() => onPreview(node.id)}
              />
            )}
          </div>
        )}
      </div>

      {/* Children */}
      {canExpand && isOpen && (
        <div className="ce-children" role="group">
          {node.children!.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              openIds={openIds}
              contextMenuId={contextMenuId}
              isEditMode={isEditMode}
              onSelect={onSelect}
              onToggle={onToggle}
              onOpenCtx={onOpenCtx}
              onCloseCtx={onCloseCtx}
              onAddSection={onAddSection}
              onDelete={onDelete}
              onPreview={onPreview}
            />
          ))}
        </div>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// OutlineTree
// ---------------------------------------------------------------------------

const OutlineTree: React.FC<OutlineTreeProps> = ({ onCollapse }) => {
  const L = useLabels();
  const treeData = useTreeStore((s) => s.treeData);
  const selectedNodeId = useTreeStore((s) => s.selectedNodeId);
  const selectNode = useTreeStore((s) => s.selectNode);
  const addNode = useTreeStore((s) => s.addNode);
  const deleteNode = useTreeStore((s) => s.deleteNode);
  const editorMode = useEditorStore((s) => s.editorMode);
  const { openModal } = useUiStore();
  const validateAndSave = useValidateAndSave();

  const isEditMode = editorMode === 'edit';

  // Open root + all sections by default
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    function collect(nodes: typeof treeData) {
      nodes.forEach(n => {
        const kind = detectNodeKind(n);
        if (kind === 'root' || kind === 'section') ids.add(n.id);
        if (n.children) collect(n.children);
      });
    }
    collect(treeData);
    return ids;
  });
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);

  const handleToggle = useCallback((id: string) => {
    setOpenIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback((id: string) => {
    selectNode(id);
  }, [selectNode]);

  const handleAddSection = useCallback(async (parentId: string) => {
    if (!(await validateAndSave())) return;
    addNode(parentId, 'section');
  }, [addNode, validateAndSave]);

  // "Create Question" always makes a standalone question (see
  // useSaveQuestion) — it is never attached to a section on creation, so
  // there's no "valid parent" to resolve here. The root id is only a local
  // scaffold for the authoring UI; it's dropped again once the create
  // succeeds. Attaching a question to a section is a separate, explicit
  // action from the Library sidebar.
  const handleCreateQuestion = useCallback(async () => {
    if (!(await validateAndSave())) return;
    const rootId = useTreeStore.getState().treeData[0]?.id;
    if (!rootId) return;
    // Remember what was selected before authoring (read AFTER
    // validateAndSave — it may have swapped a temp- section id for its real
    // one via replaceNodeId) — the temp- scratch question node is dropped
    // again once created (see useSaveQuestion), so selection should land
    // back here rather than on nothing.
    const previousSelectedNodeId = useTreeStore.getState().selectedNodeId;
    openModal('questionTypeSelector', { parentId: rootId, previousSelectedNodeId });
  }, [openModal, validateAndSave]);

  const handleDelete = useCallback((id: string) => {
    openModal('confirmDelete', { nodeId: id });
  }, [openModal]);

  const handlePreview = useCallback((id: string) => {
    useEditorStore.getState().setShowPreview(true, id);
  }, []);

  const rootId = treeData[0]?.id;

  // Determine selected node kind to conditionally disable the footer's
  // "Add Section" button ("Create Question" is always enabled).
  const selectedNode = selectedNodeId
    ? useTreeStore.getState().getNodeById(selectedNodeId)
    : null;
  const selectedKind = selectedNode ? detectNodeKind(selectedNode) : null;
  const addSectionDisabled = selectedKind === 'section' || selectedKind === 'question';

  return (
    <>
      <div className="ce-tree-head">
        <span className="lbl">{L('ui.hierarchy', 'Hierarchy')}</span>
        <button title={L('ui.collapse', 'Collapse')} onClick={onCollapse} aria-label={L('ui.collapseOutlinePanel', 'Collapse outline panel')}>
          <Icon name="panel-left" size={17} />
        </button>
      </div>

      <div className="ce-tree-scroll" role="tree" aria-label={L('ui.questionSetOutline', 'Question set outline')}>
        {treeData.length === 0 ? (
          <p style={{ padding: '16px 12px', fontSize: 13, color: 'var(--sb-text-faint)', fontStyle: 'italic' }}>
            {L('ui.noContentYet', 'No content yet.')}
          </p>
        ) : (
          treeData.map(node => (
            <TreeNode
              key={node.id}
              node={node}
              selectedId={selectedNodeId}
              openIds={openIds}
              contextMenuId={contextMenuId}
              isEditMode={isEditMode}
              onSelect={handleSelect}
              onToggle={handleToggle}
              onOpenCtx={setContextMenuId}
              onCloseCtx={() => setContextMenuId(null)}
              onAddSection={handleAddSection}
              onDelete={handleDelete}
              onPreview={handlePreview}
            />
          ))
        )}
      </div>

      {isEditMode && rootId && (
        <div className="ce-tree-foot">
          <button
            onClick={() => handleAddSection(rootId)}
            disabled={addSectionDisabled}
            style={addSectionDisabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
          >
            <Icon name="plus" size={15} />{L('ui.addSection', 'Add Section')}
          </button>
          <button onClick={() => void handleCreateQuestion()}>
            <Icon name="plus" size={15} />{L('ui.createQuestion', 'Create Question')}
          </button>
        </div>
      )}
    </>
  );
};

export default OutlineTree;
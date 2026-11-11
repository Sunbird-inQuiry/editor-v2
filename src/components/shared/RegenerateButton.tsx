import React from 'react';
import { Icon } from './Icon';
import { useLabels } from '../../hooks/useLabels';
import { useEditorStore } from '../../store/editor.store';
import { useRefreshQuestionSetBody } from '../../hooks/useRefreshQuestionSetBody';
import { telemetryInteract } from '../../utils/telemetry';

/** Re-rolls a Dynamic set's pool with unchanged settings. */
export function RegenerateButton() {
  const L = useLabels();
  const { refresh } = useRefreshQuestionSetBody();
  // Not while saving (a second concurrent hierarchy update) or while a timed-out generation may still be writing.
  const busy = useEditorStore((s) => s.buttonLoaders.refreshBody || s.buttonLoaders.refreshPending || s.buttonLoaders.saveContent);
  return (
    <button
      type="button"
      className="ce-btn ghost"
      onClick={() => { telemetryInteract('dynamic_assess_regenerate', { subtype: 'submit' }); void refresh(); }}
      disabled={busy}
      title={L('ui.regenerateQuestionsHint', 'Pick a new random set of questions for the same Skill and Difficulty Target')}
    >
      <Icon name="swap" size={15} />
      {L('ui.regenerateQuestions', 'Regenerate')}
    </button>
  );
}

export default RegenerateButton;

import React from 'react';
import { label } from '../../utils/labels';
import { Icon } from './Icon';

/** Explains why review is blocked when the saved Skill/Difficulty Target don't match the questions (e.g. a failed or older generation); Save & Generate is the fix. */
export function StaleSettingsBanner({ open, canRegenerate, pending = false }: { open: boolean; canRegenerate: boolean; pending?: boolean }) {
  if (!open) return null;
  if (pending) {
    return (
      <div className="ce-stale-banner" role="alert">
        <span className="ce-stale-banner-ic" aria-hidden="true"><Icon name="clock" size={17} /></span>
        <div className="ce-stale-banner-tx">
          <p className="ce-stale-banner-title">{label('messages.info.dynamicAssessPendingTitle', 'Questions are still being generated')}</p>
          <p className="ce-stale-banner-sub">{label('messages.info.dynamicAssessPendingSub', 'Reopen this question set in a moment to see them. Saving is paused so the new questions aren\'t overwritten.')}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="ce-stale-banner" role="alert">
      <span className="ce-stale-banner-ic" aria-hidden="true"><Icon name="info" size={17} /></span>
      <div className="ce-stale-banner-tx">
        <p className="ce-stale-banner-title">{label('messages.info.dynamicAssessStaleTitle', 'Settings changed since the questions were generated')}</p>
        <p className="ce-stale-banner-sub">
          {canRegenerate
            ? label('messages.info.dynamicAssessStaleSub', "The questions don't match the current Skill and Difficulty Target. Click Save & Generate to update them.")
            : label('messages.info.dynamicAssessStaleSubReadonly', 'The questions no longer match the Skill or Difficulty Target. Request changes so the creator can regenerate them.')}
        </p>
      </div>
    </div>
  );
}

export default StaleSettingsBanner;

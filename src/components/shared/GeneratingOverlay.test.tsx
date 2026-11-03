import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { GeneratingOverlay } from './GeneratingOverlay';
import { StaleSettingsBanner } from './StaleSettingsBanner';

describe('GeneratingOverlay', () => {
  it('renders a blocking status loader while generating (positive)', () => {
    const html = renderToStaticMarkup(<GeneratingOverlay open />);
    expect(html).toContain('role="status"');
    expect(html).toContain('ce-modal-scrim');
    expect(html).toContain('Generating questions');
  });

  it('renders nothing when not generating (negative)', () => {
    expect(renderToStaticMarkup(<GeneratingOverlay open={false} />)).toBe('');
  });

  it('has no Cancel button (negative)', () => {
    expect(renderToStaticMarkup(<GeneratingOverlay open />)).not.toContain('<button');
  });
});

describe('StaleSettingsBanner', () => {
  it('points the creator at Save & Generate, with no button of its own (positive)', () => {
    const html = renderToStaticMarkup(<StaleSettingsBanner open canRegenerate />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Click Save &amp; Generate to update them');
    expect(html).not.toContain('<button');
  });

  it('tells a reviewer to request changes (positive)', () => {
    expect(renderToStaticMarkup(<StaleSettingsBanner open canRegenerate={false} />)).toContain('Request changes');
  });

  it('renders nothing when the saved settings match (negative)', () => {
    expect(renderToStaticMarkup(<StaleSettingsBanner open={false} canRegenerate />)).toBe('');
  });

  it('says generation is still running and saving is paused when a generation timed out (positive)', () => {
    const html = renderToStaticMarkup(<StaleSettingsBanner open pending canRegenerate />);
    expect(html).toContain('Questions are still being generated');
    expect(html).toContain('Saving is paused');
  });
});

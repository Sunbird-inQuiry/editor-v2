import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initTelemetry, telemetryStart, flushTelemetry } from './telemetry';
import type { IContext } from '../types/editor';

const ctx: IContext = {
  sid: 'sid-1',
  did: 'did-1',
  channel: 'channel-1',
  pdata: { id: 'test', ver: '1.0' },
  host: 'https://example.com',
} as IContext;

describe('telemetry dispatch / window.EkTelemetry handoff', () => {
  beforeEach(() => {
    initTelemetry(ctx, 'do_123');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve()));
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hands the event to window.EkTelemetry when present', () => {
    const start = vi.fn();
    (window as { EkTelemetry?: unknown }).EkTelemetry = { start };
    telemetryStart();
    expect(start).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falls back to the internal batcher when window.EkTelemetry throws', () => {
    (window as { EkTelemetry?: unknown }).EkTelemetry = {
      start: () => { throw new TypeError("Cannot read properties of undefined (reading 'duration')"); },
    };
    expect(() => telemetryStart()).not.toThrow();
    flushTelemetry();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the internal batcher when window.EkTelemetry is absent', () => {
    telemetryStart();
    flushTelemetry();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

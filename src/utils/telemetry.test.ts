import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initTelemetry,
  telemetryStart,
  telemetryEnd,
  telemetryImpression,
  telemetryInteract,
  telemetryError,
  setTelemetryPageId,
  flushTelemetry,
} from './telemetry';
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

describe('telemetry — uri/duration/pageid/stacktrace fidelity (old editor parity)', () => {
  beforeEach(() => {
    initTelemetry(ctx, 'do_123');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve()));
    vi.stubGlobal('window', { location: { href: 'https://example.com/edit/do_123' } });
    vi.stubGlobal('navigator', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('IMPRESSION carries the real page uri and a numeric duration', () => {
    const impression = vi.fn();
    (window as { EkTelemetry?: unknown }).EkTelemetry = { impression };
    telemetryImpression();
    const edata = impression.mock.calls[0][0].edata;
    expect(edata.uri).toBe('https://example.com/edit/do_123');
    expect(typeof edata.duration).toBe('number');
  });

  it('END carries a numeric duration', () => {
    const end = vi.fn();
    (window as { EkTelemetry?: unknown }).EkTelemetry = { end };
    telemetryEnd();
    expect(typeof end.mock.calls[0][0].edata.duration).toBe('number');
  });

  it('ERROR carries pageid and an empty stacktrace when no detail is given', () => {
    setTelemetryPageId('question_editor');
    const error = vi.fn();
    (window as { EkTelemetry?: unknown }).EkTelemetry = { error };
    telemetryError('Failed to save.');
    const edata = error.mock.calls[0][0].edata;
    expect(edata.pageid).toBe('question_editor');
    expect(edata.stacktrace).toBe('');
  });

  it('ERROR carries a JSON stacktrace when detail is given', () => {
    const error = vi.fn();
    (window as { EkTelemetry?: unknown }).EkTelemetry = { error };
    telemetryError('Failed to save.', undefined, { status: 500, url: '/api/question/update' });
    const edata = error.mock.calls[0][0].edata;
    expect(JSON.parse(edata.stacktrace)).toEqual({ status: 500, url: '/api/question/update' });
  });
});

describe('telemetryInteract — subtype/extra (old editor getTelemetryInteractEdata parity)', () => {
  beforeEach(() => {
    initTelemetry(ctx, 'do_123');
    setTelemetryPageId('questionset_editor'); // pageId is module state; reset since another suite may have changed it
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve()));
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('omits subtype/extra when not provided', () => {
    const interact = vi.fn();
    (window as { EkTelemetry?: unknown }).EkTelemetry = { interact };
    telemetryInteract('add_option');
    const edata = interact.mock.calls[0][0].edata;
    expect(edata).toEqual({ type: 'click', id: 'add_option', pageid: 'questionset_editor' });
  });

  it('includes subtype and extra when provided (e.g. mark_as_right_anwser carries which option)', () => {
    const interact = vi.fn();
    (window as { EkTelemetry?: unknown }).EkTelemetry = { interact };
    telemetryInteract('mark_as_right_anwser', { extra: { answer: '1' } });
    const edata = interact.mock.calls[0][0].edata;
    expect(edata.subtype).toBeUndefined();
    expect(edata.extra).toEqual({ answer: '1' });
  });

  it('allows an explicit pageid override', () => {
    const interact = vi.fn();
    (window as { EkTelemetry?: unknown }).EkTelemetry = { interact };
    telemetryInteract('solution_type', { pageid: 'question', subtype: 'single_select', extra: { solution_type: 'video' } });
    const edata = interact.mock.calls[0][0].edata;
    expect(edata).toEqual({
      type: 'click',
      id: 'solution_type',
      pageid: 'question',
      subtype: 'single_select',
      extra: { solution_type: 'video' },
    });
  });
});

describe('telemetry — context.uid / pdata.pid env-suffixing (old editor parity)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve()));
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('context.uid matches the old-editor context shape (user.id)', () => {
    initTelemetry({ ...ctx, user: { id: 'user-1' } } as IContext, 'do_123');
    const start = vi.fn();
    (window as { EkTelemetry?: unknown }).EkTelemetry = { start };
    telemetryStart();
    const event = start.mock.calls[0][0];
    expect(event.context.uid).toBe('user-1');
    expect(event.actor.id).toBe('user-1');
  });

  it("context.uid matches the standalone-host context shape (userId), so it never disagrees with actor.id", () => {
    initTelemetry({ ...ctx, userId: 'user-2' } as IContext, 'do_123');
    const start = vi.fn();
    (window as { EkTelemetry?: unknown }).EkTelemetry = { start };
    telemetryStart();
    const event = start.mock.calls[0][0];
    expect(event.context.uid).toBe('user-2');
    expect(event.actor.id).toBe('user-2');
  });

  it('context.pdata.pid is env-suffixed once at init, without mutating the host-owned pdata object', () => {
    const hostPdata = { id: 'sunbird-questionset-editor', ver: '1.0', pid: 'contentEditor' };
    initTelemetry({ ...ctx, env: 'staging', pdata: hostPdata } as IContext, 'do_123');
    const start = vi.fn();
    (window as { EkTelemetry?: unknown }).EkTelemetry = { start };
    telemetryStart();
    expect(start.mock.calls[0][0].context.pdata.pid).toBe('contentEditor.staging');
    expect(hostPdata.pid).toBe('contentEditor'); // untouched
  });
});

describe('telemetry — apislug URL prefix + real-SDK headers (old editor parity)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve()));
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults the telemetry URL to the /action apislug when the host does not provide one', () => {
    initTelemetry(ctx, 'do_123');
    telemetryStart();
    flushTelemetry();
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://example.com/action/data/v3/telemetry');
  });

  it('honors an explicit host-provided apislug', () => {
    initTelemetry({ ...ctx, apislug: '/custom' } as IContext, 'do_123');
    telemetryStart();
    flushTelemetry();
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://example.com/custom/data/v3/telemetry');
  });

  it('sends x-app-id/x-device-id/x-channel-id alongside Content-Type on the fetch path', () => {
    initTelemetry(ctx, 'do_123');
    telemetryStart();
    flushTelemetry();
    const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-app-id': 'test',
      'x-device-id': 'did-1',
      'x-channel-id': 'channel-1',
    });
  });
});

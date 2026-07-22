/**
 * Telemetry emitter — parity with the old editor's telemetry.service.ts:
 * START / END / IMPRESSION / INTERACT / ERROR events with the standard
 * Sunbird envelope, batched (size 20 like the old CsTelemetryModule config)
 * and POSTed to `${context.host}${apislug || '/action'}${context.endpoint || '/data/v3/telemetry'}`.
 * When the host page provides window.EkTelemetry, events are handed to it
 * instead of the internal batcher.
 */
import type { IContext } from '../types/editor';

declare global {
  interface Window {
    EkTelemetry?: Record<string, (data: Record<string, unknown>) => void>;
  }
}

const BATCH_SIZE = 20;
const VER = '3.0';

let ctx: IContext | null = null;
let objectId = '';
let pageId = 'questionset_editor';
let buffer: Array<Record<string, unknown>> = [];
// Old editor parity (editor.component.ts's pageStartTime) — set once when the
// editor mounts, reused to compute `duration` on every IMPRESSION/END.
let editorMountedAt = 0;
// Old editor parity (telemetry.service.ts's `this.pdata.pid = \`${pid}.${env}\``)
// — an env-suffixed app id for downstream analytics segmentation, derived
// once at init rather than mutating the host-owned context.pdata in place.
let resolvedPdata: { id: string; ver: string; pid?: string } | null = null;

/** Old editor parity (telemetry.service.ts's `this.uid = this.context.uid`) —
 * shared by actor.id and context.uid so the two never disagree for the
 * flexible/standalone-host context shape this editor also supports. */
function resolveUid(context: IContext | null): string {
  return context?.user?.id ?? context?.userId ?? context?.uid ?? 'anonymous';
}

function currentUri(): string {
  // No client-side router in this app (confirmed: no react-router usage) —
  // the actual browser URL is the closest real equivalent to old's
  // `this.router.url`, and does change if this editor is embedded at a real
  // route in the host portal.
  return typeof window !== 'undefined' && window.location ? window.location.href : '';
}

function mid(): string {
  return `QS:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function endpointUrl(): string {
  const host = ctx?.host ?? '';
  // Real telemetry-sdk parity: URL is host + apislug + endpoint (default
  // apislug '/action') — neither the portal nor old editor ever override
  // this in practice, they rely on the SDK's own default, same as
  // player-v2's initializeCsSdk.
  const apislug = ctx?.apislug || '/action';
  const endpoint = ctx?.endpoint || '/data/v3/telemetry';
  return `${host}${apislug}${endpoint}`;
}

function buildEvent(eid: string, edata: Record<string, unknown>): Record<string, unknown> {
  return {
    eid,
    ets: Date.now(),
    ver: VER,
    mid: mid(),
    actor: { id: resolveUid(ctx), type: 'User' },
    context: {
      channel: ctx?.channel ?? '',
      pdata: resolvedPdata ?? ctx?.pdata ?? { id: 'sunbird-questionset-editor', ver: '1.0' },
      env: ctx?.env ?? 'questionset_editor',
      sid: ctx?.sid ?? '',
      uid: resolveUid(ctx),
      did: ctx?.did ?? '',
      cdata: ctx?.cdata ?? [],
      rollup: ctx?.contextRollup ?? ctx?.rollup ?? {},
    },
    object: objectId
      ? { id: objectId, type: 'QuestionSet', ver: '1.0', rollup: ctx?.objectRollup ?? {} }
      : undefined,
    edata,
  };
}

function flush(useBeacon = false): void {
  if (!buffer.length || !ctx) return;
  const events = buffer;
  buffer = [];
  const payload = JSON.stringify({
    id: 'api.sunbird.telemetry',
    ver: VER,
    params: { msgid: mid() },
    ets: Date.now(),
    events,
  });
  const url = endpointUrl();
  try {
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      return;
    }
    void fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ctx.authToken ? { Authorization: `Bearer ${ctx.authToken}` } : {}),
        // Real telemetry-sdk parity (TelemetrySyncManager.syncEvents) — only
        // reachable here, not on the sendBeacon path below: sendBeacon can't
        // carry custom headers at all, a browser API limitation the real SDK
        // (jQuery.ajax-only, no sendBeacon path) never has to deal with either.
        'x-app-id': (resolvedPdata ?? ctx.pdata)?.id ?? '',
        'x-device-id': ctx.did ?? '',
        'x-channel-id': ctx.channel ?? '',
      },
      body: payload,
      keepalive: true,
    }).catch(() => { /* telemetry must never break the editor */ });
  } catch { /* ignore */ }
}

function dispatch(eid: string, edata: Record<string, unknown>): void {
  if (!ctx) return;
  const method = eid.toLowerCase();
  const ek = window.EkTelemetry;
  if (ek && typeof ek[method] === 'function') {
    // window.EkTelemetry is a page-wide shared telemetry instance another
    // widget on the page may have already initialised (the underlying SDK's
    // own convention — see CsTelemetryModule in the old editor). Its methods
    // are built for THAT widget's event shape, not necessarily ours — e.g. a
    // video player's handler expecting a duration field a questionset event
    // doesn't have. Telemetry must never break the editor, so fall back to
    // the internal batcher if the shared instance can't handle this event.
    try {
      ek[method]!(buildEvent(eid, edata));
      return;
    } catch { /* fall through to internal batcher */ }
  }
  buffer.push(buildEvent(eid, edata));
  if (buffer.length >= BATCH_SIZE) flush();
}

// ── Public API (old telemetry.service parity) ───────────────────────────────

export function initTelemetry(context: IContext, contentId: string): void {
  ctx = context;
  objectId = contentId;
  editorMountedAt = Date.now();
  resolvedPdata = context.pdata
    ? {
        ...context.pdata,
        pid: context.pdata.pid
          ? `${context.pdata.pid}.${context.env ?? 'questionset_editor'}`
          : context.pdata.pid,
      }
    : null;
}

export function setTelemetryPageId(id: string): void {
  pageId = id;
}

export function telemetryStart(): void {
  dispatch('START', { type: 'editor', pageid: pageId, mode: 'edit', uaspec: {} });
}

export function telemetryEnd(): void {
  dispatch('END', {
    type: 'editor',
    pageid: pageId,
    duration: (Date.now() - editorMountedAt) / 1000,
  });
  flush(true);
}

export function telemetryImpression(pageid = pageId): void {
  dispatch('IMPRESSION', {
    type: 'edit',
    pageid,
    uri: currentUri(),
    duration: (Date.now() - editorMountedAt) / 1000,
  });
}

/**
 * Old editor parity (telemetry.service.ts's getTelemetryInteractEdata):
 * `subtype`/`extra` carry real signal (e.g. which option was marked
 * correct) — included only when provided, omitted otherwise (matches old's
 * `_.omitBy(..., _.isUndefined)`).
 */
export function telemetryInteract(
  id: string,
  options?: { pageid?: string; subtype?: string; extra?: Record<string, unknown> },
): void {
  dispatch('INTERACT', {
    type: 'click',
    id,
    pageid: options?.pageid ?? pageId,
    ...(options?.subtype !== undefined ? { subtype: options.subtype } : {}),
    ...(options?.extra !== undefined ? { extra: options.extra } : {}),
  });
}

/**
 * Log a player/editor-level error. `detail` carries real diagnostic context
 * (old editor parity: apiErrorHandling's `{response, request}`) — pass the
 * raw error/response info when available; omitted for messages with no
 * underlying error object (e.g. a client-side validation notice).
 */
export function telemetryError(err: string, errtype = 'SYSTEM', detail?: unknown): void {
  dispatch('ERROR', {
    err,
    errtype,
    stacktrace: detail !== undefined ? JSON.stringify(detail) : '',
    pageid: pageId,
  });
}

export function flushTelemetry(): void {
  flush(true);
}

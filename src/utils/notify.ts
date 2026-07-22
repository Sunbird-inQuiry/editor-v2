import toast from 'react-hot-toast';
import { createElement } from 'react';

// Static icon — react-hot-toast's animated checkmark/error icons rely on
// delayed CSS keyframes that host-page styles can interrupt, leaving the
// intermediate spinner arc on screen.
function statusIcon(background: string, glyph: string) {
  return createElement('span', {
    style: {
      display: 'grid', placeItems: 'center', flex: 'none',
      width: 20, height: 20, borderRadius: '50%',
      background, color: '#fff', fontSize: 12, fontWeight: 800, lineHeight: 1,
    },
  }, glyph);
}

// One consistent look for every API success/failure notification —
// themed like the app's cards (sb tokens), top-right via the shared Toaster.
const baseStyle: React.CSSProperties = {
  fontFamily: 'var(--sb-font)',
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--sb-text)',
  background: 'var(--sb-card, #fff)',
  border: '1px solid var(--sb-border)',
  borderRadius: '12px',
  boxShadow: 'var(--sb-shadow-deep)',
  padding: '12px 16px',
  maxWidth: '440px',
};

export function notifySuccess(message: string): void {
  toast.success(message, {
    style: baseStyle,
    icon: statusIcon('var(--sb-green, #16a34a)', '✓'),
  });
}

/**
 * `error` is the raw error/response that produced `message` (an axios error
 * from `src/api/client.ts`, when there is one) — threaded through to
 * telemetry's ERROR `stacktrace` so silent API failures carry real diagnostic
 * detail (old editor parity: `apiErrorHandling`'s `{response, request}`).
 * Optional: some call sites have no underlying error (e.g. a client-side
 * validation notice).
 */
export function notifyError(message: string, error?: unknown): void {
  toast.error(message, {
    style: baseStyle,
    duration: 5000,
    icon: statusIcon('var(--sb-red, #dc2626)', '✕'),
  });
  // Old editor logs an ERROR telemetry event for surfaced failures.
  const detail =
    error && typeof error === 'object'
      ? {
          status: (error as { response?: { status?: number } }).response?.status,
          data: (error as { response?: { data?: unknown } }).response?.data,
          url: (error as { config?: { url?: string } }).config?.url,
        }
      : undefined;
  void import('./telemetry').then(({ telemetryError }) => telemetryError(message, undefined, detail));
}

/** Prefer the server's errmsg (surfaced by the api client) over a generic fallback. */
export function apiErrorMessage(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : '';
  return msg && !/^Request failed|^Network Error|timeout/i.test(msg) ? msg : fallback;
}

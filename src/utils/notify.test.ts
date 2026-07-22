import { describe, it, expect, vi, afterEach } from 'vitest';

const { telemetryError } = vi.hoisted(() => ({ telemetryError: vi.fn() }));
vi.mock('./telemetry', () => ({ telemetryError }));

import { notifyError } from './notify';

describe('notifyError — threads real error detail into telemetryError (old editor apiErrorHandling parity)', () => {
  afterEach(() => {
    telemetryError.mockClear();
  });

  it('passes no stacktrace detail when no error object is given', async () => {
    notifyError('No content identifier found.');
    await vi.waitFor(() => expect(telemetryError).toHaveBeenCalledTimes(1));
    expect(telemetryError).toHaveBeenCalledWith('No content identifier found.', undefined, undefined);
  });

  it('extracts status/data/url from an axios-shaped error into the detail object', async () => {
    const axiosError = {
      response: { status: 500, data: { params: { errmsg: 'Internal error' } } },
      config: { url: '/api/question/v2/update/do_123' },
    };
    notifyError('Failed to save question. Please try again.', axiosError);
    await vi.waitFor(() => expect(telemetryError).toHaveBeenCalledTimes(1));
    expect(telemetryError).toHaveBeenCalledWith(
      'Failed to save question. Please try again.',
      undefined,
      {
        status: 500,
        data: { params: { errmsg: 'Internal error' } },
        url: '/api/question/v2/update/do_123',
      },
    );
  });
});

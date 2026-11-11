import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { apiClient, setApiBaseUrl, setApiSlug } from './client';
import { refreshQuestionSetBody } from './hierarchy';
import { questionBucketCounts, questionSkillCounts } from './content';

describe('Dynamic Assess API calls', () => {
  const captured: InternalAxiosRequestConfig[] = [];
  let failNext = 0;

  beforeEach(() => {
    setApiBaseUrl('');
    setApiSlug('/api');
    captured.length = 0;
    failNext = 0;
    apiClient.defaults.adapter = async (config) => {
      captured.push(config);
      if (failNext > 0) {
        failNext -= 1;
        return { data: { responseCode: 'SERVER_ERROR', params: { errmsg: 'boom' } }, status: 500, statusText: 'ERR', headers: {}, config } as AxiosResponse;
      }
      return { data: { responseCode: 'OK', result: { count: 7 } }, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse;
    };
  });

  afterEach(() => {
    apiClient.defaults.adapter = undefined;
  });

  it('sends refresh/body with the same request envelope as its sibling POSTs (positive)', async () => {
    await refreshQuestionSetBody('do_qs1');
    const req = captured[0]!;
    expect(req.url).toContain('refresh/body/do_qs1');
    expect(JSON.parse(String(req.data))).toEqual({ request: { questionset: {} } });
  });

  it('retries one failed count search instead of failing the whole pool check (positive)', async () => {
    failNext = 1;
    const counts = await questionSkillCounts('skill', ['Physics']);
    expect(counts).toEqual({ Physics: 7 });
    expect(captured).toHaveLength(2);
  });

  it('still fails when a count search fails twice, so the check never passes on missing data (negative)', async () => {
    failNext = 6; // all three level searches and their retries
    await expect(questionBucketCounts('skill', ['Physics'], 'ch1')).rejects.toBeTruthy();
  });
});

import { apiClient } from './client';
import { URLS } from './urls';
import type { IContent } from '../types/content';

export async function compositeSearch(params: {
  filters?: Record<string, unknown>;
  query?: string;
  limit?: number;
  offset?: number;
  fields?: string[];
  channel?: string;
  sortBy?: Record<string, string>;
}): Promise<{ content: IContent[]; count: number }> {
  const baseFilters: Record<string, unknown> = {
    status: ['Live'],
    objectType: ['Question'],
    // Only "Default"-visibility questions are standalone, reusable objects —
    // "Parent"-visibility questions are bound to the questionset that
    // created them and cannot be attached anywhere else (see plan.md).
    visibility: ['Default'],
    ...(params.filters ?? {}),
  };
  if (params.channel) baseFilters['channel'] = params.channel;

  const response = await apiClient.post(URLS.composite.search, {
    request: {
      filters: baseFilters,
      query: params.query ?? '',
      limit: params.limit ?? 20,
      offset: params.offset ?? 0,
      sort_by: params.sortBy ?? { lastUpdatedOn: 'desc' },
      fields: params.fields ?? [
        'identifier', 'name', 'mimeType', 'contentType', 'primaryCategory',
        'appIcon', 'channel', 'questionType', 'difficultyLevel', 'bloomsLevel',
        'visibility', 'subject', 'gradeLevel',
      ],
    },
  });

  const result = response.data?.result ?? {};
  return {
    content: (result.Question ?? result.content ?? []) as IContent[],
    count: (result.count ?? 0) as number,
  };
}

/** The Live count for one search, retried once so a single transient failure doesn't fail the whole pool check (search doesn't allow facets on these fields). */
async function searchCount(filters: Record<string, unknown>): Promise<number> {
  const request = () => apiClient.post(URLS.composite.search, { request: { filters, fields: ['identifier'], limit: 1 } });
  const response = await request().catch(() => request());
  return Number(response.data?.result?.count ?? 0) || 0;
}

/** Live Question counts per skill x difficultyLevel, the availability the job allocates from (same channel + category filters, no visibility filter). */
export async function questionBucketCounts(
  categoryField: string,
  skills: string[],
  channel?: string,
): Promise<Record<string, Record<'E' | 'M' | 'D', number>>> {
  const levels = [['E', 'EASY'], ['M', 'MEDIUM'], ['D', 'DIFFICULT']] as const;
  const pairs = skills.flatMap((skill) => levels.map(([key, difficultyLevel]) => ({ skill, key, difficultyLevel })));
  const counts = await Promise.all(pairs.map(({ skill, difficultyLevel }) => {
    const filters: Record<string, unknown> = { status: ['Live'], objectType: 'Question', [categoryField]: [skill], difficultyLevel };
    if (channel) filters.channel = channel;
    return searchCount(filters);
  }));
  const out: Record<string, Record<'E' | 'M' | 'D', number>> = {};
  pairs.forEach(({ skill, key }, i) => {
    out[skill] = out[skill] ?? { E: 0, M: 0, D: 0 };
    out[skill][key] = counts[i] ?? 0;
  });
  return out;
}

/** Live Question counts per skill, with the same filters knowlg-service uses to reject a refresh (no channel, any level). */
export async function questionSkillCounts(categoryField: string, skills: string[]): Promise<Record<string, number>> {
  const counts = await Promise.all(skills.map((skill) => searchCount({ status: ['Live'], objectType: 'Question', [categoryField]: [skill] })));
  return Object.fromEntries(skills.map((skill, i) => [skill, counts[i] ?? 0]));
}

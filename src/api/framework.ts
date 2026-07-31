import { apiClient } from './client';
import { URLS } from './urls';
import type { IFramework, ITerm } from '../types/framework';

export async function getFramework(frameworkId: string): Promise<IFramework> {
  const response = await apiClient.get(`${URLS.framework.read}/${frameworkId}`);
  return response.data?.result?.framework as IFramework;
}

/** Live frameworks available for the Framework picker — channel is scoped
 *  via apiClient's own X-Channel-Id header, not a body filter (matches how
 *  the backend actually expects this search). `type`/`systemDefault` are
 *  caller-supplied (see useFrameworkOptions.ts) rather than hardcoded here —
 *  which types are relevant comes from the category definition's own
 *  orgFWType, the same way the collection editor derives it. */
export async function searchFrameworks(filters: {
  type?: string[];
  systemDefault?: string;
} = {}): Promise<Array<{ identifier: string; name: string; type?: string }>> {
  const response = await apiClient.post(URLS.composite.search, {
    request: {
      filters: {
        objectType: 'Framework',
        status: ['Live'],
        ...(filters.type?.length ? { type: filters.type } : {}),
        ...(filters.systemDefault ? { systemDefault: filters.systemDefault } : {}),
      },
    },
  });
  return (response.data?.result?.Framework ?? []) as Array<{ identifier: string; name: string; type?: string }>;
}

export async function searchTerms(
  frameworkId: string,
  categoryCode: string,
  query?: string,
): Promise<ITerm[]> {
  const response = await apiClient.get(URLS.framework.termRead, {
    params: { frameworkId, codeId: categoryCode, ...(query ? { query } : {}) },
  });
  return (response.data?.result?.terms ?? []) as ITerm[];
}

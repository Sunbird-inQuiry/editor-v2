import { apiClient } from './client';
import { URLS } from './urls';
import type { INode } from '../types/editor';

function mapToINode(raw: unknown, parentId?: string): INode {
  const r = (raw ?? {}) as Record<string, unknown>;
  const identifier = (r['identifier'] as string) ?? '';
  const objectType = (r['objectType'] as string) ?? '';
  const mime = (r['mimeType'] as string) ?? '';
  const primaryCategory = (r['primaryCategory'] as string) ?? '';

  const isFolder =
    mime === 'application/vnd.ekstep.content-collection' ||
    objectType === 'QuestionSet' ||
    primaryCategory === 'Question Set' ||
    (r['visibility'] as string) === 'Parent';

  const isQuestion =
    objectType === 'Question' ||
    mime === 'application/vnd.sunbird.question';

  const rawChildren = r['children'];
  const children: INode[] = Array.isArray(rawChildren)
    ? rawChildren.map((child) => mapToINode(child, identifier))
    : [];

  return {
    id: identifier,
    identifier,
    name: (r['name'] as string) ?? 'Untitled',
    title: (r['name'] as string) ?? 'Untitled',
    description: r['description'] as string | undefined,
    primaryCategory: primaryCategory || undefined,
    mimeType: mime || undefined,
    objectType,
    contentType: r['contentType'] as string | undefined,
    visibility: r['visibility'] as string | undefined,
    status: r['status'] as string | undefined,
    appIcon: r['appIcon'] as string | undefined,
    isFolder,
    isQuestion,
    questionType: r['questionType'] as string | undefined,
    children,
    metadata: r as Record<string, unknown>,
    parent: parentId,
  };
}

// Fields not present in the hierarchy response that are needed for the form.
const EXTRA_FIELDS = URLS.questionSet.defaultFields;

export async function readQuestionSet(
  contentId: string,
): Promise<Record<string, unknown>> {
  const response = await apiClient.get(
    `${URLS.questionSet.read}/${contentId}`,
    { params: { mode: 'edit', fields: EXTRA_FIELDS } },
  );
  const result =
    response.data?.result?.questionSet as Record<string, unknown> | undefined ??
    response.data?.result?.questionset as Record<string, unknown> | undefined ??
    {};
  // The form edits maxTime (seconds); the backend persists it as
  // timeLimits.questionSet.max — map it back so the timer field populates.
  const max = (result.timeLimits as { questionSet?: { max?: number } } | undefined)?.questionSet?.max;
  if (typeof max === 'number' && result.maxTime === undefined) {
    result.maxTime = max;
  }
  return result;
}

export async function readHierarchy(
  contentId: string,
): Promise<{ content: Record<string, unknown>; rootNode: INode }> {
  const response = await apiClient.get(
    `${URLS.questionSet.hierarchyRead}/${contentId}`,
    { params: { mode: 'edit' } },
  );
  const content = response.data?.result?.questionSet as Record<string, unknown> | undefined
    ?? response.data?.result?.questionset as Record<string, unknown> | undefined
    ?? response.data?.result?.content as Record<string, unknown> | undefined;

  if (!content || !content['identifier']) {
    const reason =
      (response.data?.params?.errmsg as string) ||
      (response.data?.params?.err as string) ||
      `No content returned for "${contentId}"`;
    throw new Error(`Unable to load hierarchy: ${reason}`);
  }
  return { content, rootNode: mapToINode(content) };
}

export async function updateHierarchy(
  _contentId: string,
  nodesModified: Record<string, unknown>,
  hierarchy: Record<string, unknown>,
  lastUpdatedBy?: string,
): Promise<{ identifiers: Record<string, string> }> {
  const response = await apiClient.patch(URLS.questionSet.hierarchyUpdate, {
    request: {
      data: {
        nodesModified,
        hierarchy,
        ...(lastUpdatedBy ? { lastUpdatedBy } : {}),
      },
    },
  });
  return {
    identifiers: (response.data?.result?.identifiers ?? {}) as Record<string, string>,
  };
}

/**
 * Guards the one falsy value that must NOT be read as "target the root". Only `null` may mean the
 * root; `''` is always a caller bug (an unresolved section id), and letting it through would send
 * the operation to the root silently instead of erroring.
 */
function assertCollectionId(collectionId: string | null): void {
  if (collectionId === '') {
    throw new Error(
      "collectionId must be a section id or null — '' would silently target the questionset root",
    );
  }
}

/**
 * `PATCH questionset/v2/add` — attaches existing questions to a collection; appends after maxIndex.
 * `collectionId` is the target section id, or `null` to attach directly to the root QuestionSet
 * (the backend's root-attach path, used when there is no section).
 *
 * `''` is rejected rather than treated as `null`: omitting collectionId routes to the backend's
 * root path, so an accidental empty string would silently operate on the root instead of failing
 * loudly with "collectionId ... does not exist". Only an explicit `null` may mean "the root".
 */
export async function addQuestionsToSet(
  rootId: string,
  collectionId: string | null,
  children: string[],
): Promise<void> {
  assertCollectionId(collectionId);
  const questionset: Record<string, unknown> = { rootId, children };
  if (collectionId) questionset.collectionId = collectionId;
  await apiClient.patch(URLS.questionSet.add, {
    request: { questionset },
  });
}

/**
 * `DELETE questionset/v2/remove` — detaches questions from a collection (never retires them).
 * `collectionId` is the section id, or `null` to detach a question that sits directly under the
 * root (the backend's root-remove path). A root-level question's parent IS the root, so passing it
 * as `collectionId` is rejected by the backend — pass `null` instead.
 *
 * `''` is rejected here for the same reason as in addQuestionsToSet, and the stakes are higher on
 * this path: the backend's root-remove runs `childNodes.removeAll(children)` on the root
 * unconditionally, so an empty string for a question that actually lives in a section would strip
 * it from the questionset's childNodes while leaving it in the section — silent corruption.
 */
export async function removeQuestionsFromSet(
  rootId: string,
  collectionId: string | null,
  children: string[],
): Promise<void> {
  assertCollectionId(collectionId);
  const questionset: Record<string, unknown> = { rootId, children };
  if (collectionId) questionset.collectionId = collectionId;
  await apiClient.delete(URLS.questionSet.removeNode, {
    data: { request: { questionset } },
  });
}

export async function publishContent(contentId: string, lastPublishedBy = ''): Promise<void> {
  await apiClient.post(`${URLS.questionSet.publish}/${contentId}`, {
    request: { questionset: { lastPublishedBy } },
  });
}

export async function sendForReview(contentId: string): Promise<void> {
  await apiClient.post(`${URLS.questionSet.review}/${contentId}`, {
    request: { questionset: {} },
  });
}

export async function rejectContent(contentId: string, comment: string): Promise<void> {
  await apiClient.post(`${URLS.questionSet.reject}/${contentId}`, {
    request: { questionset: { rejectComment: comment } },
  });
}

import { apiClient } from './client';
import { URLS } from './urls';

// Standalone (visibility: "Default") questions are created/updated directly
// through these APIs (useSaveQuestion) instead of the hierarchy-update flow —
// see plan.md. Legacy visibility:"Parent" questions still go through
// questionset/hierarchy/update.

export interface ICreateQuestionResult {
  identifier: string;
  versionKey: string;
}

/** `POST question/v2/create` — metadata must set visibility: "Default". */
export async function createQuestion(
  metadata: Record<string, unknown>,
): Promise<ICreateQuestionResult> {
  const response = await apiClient.post(URLS.question.create, {
    request: { question: metadata },
  });
  const result = (response.data?.result ?? {}) as Record<string, unknown>;
  return {
    identifier: (result.identifier as string) ?? '',
    versionKey: (result.versionKey as string) ?? '',
  };
}

// Identity/system fields the backend locks once a question is created —
// question/v5/update's RequestUtil.restrictProperties rejects the whole
// request (ERROR_RESTRICTED_PROP) if any of these are present, even when
// the value matches what's already stored. Some of these (e.g. mimeType)
// are legitimately part of create's payload but become immutable after.
const UPDATE_RESTRICTED_PROPS = ['visibility', 'code', 'status', 'mimeType', 'qumlVersion', 'schemaVersion'];

/** `PATCH question/v2/update/:id` — rejects visibility:"Parent" nodes. */
export async function updateQuestion(
  questionId: string,
  versionKey: string,
  metadata: Record<string, unknown>,
): Promise<{ versionKey: string }> {
  const question: Record<string, unknown> = { ...metadata, versionKey };
  for (const key of UPDATE_RESTRICTED_PROPS) delete question[key];

  const response = await apiClient.patch(`${URLS.question.update}/${questionId}`, {
    request: { question },
  });
  const result = (response.data?.result ?? {}) as Record<string, unknown>;
  return { versionKey: (result.versionKey as string) ?? versionKey };
}

/**
 * `POST question/v2/publish` — moves a Draft standalone question to Live.
 * The library search (composite/v3/search) only surfaces status:"Live"
 * questions, so a newly-created standalone question needs this right away —
 * like the old AssessmentItem flow, where every created item was usable
 * immediately, not left in an invisible Draft state.
 */
export async function publishQuestion(questionId: string): Promise<void> {
  await apiClient.post(`${URLS.question.publish}/${questionId}`, {
    request: { question: {} },
  });
}

/**
 * Fields requested on question read — the old editor's
 * `editor.config.json → readQuestionFields` list, verbatim.
 */
export const READ_QUESTION_FIELDS =
  'body,primaryCategory,mimeType,qType,answer,templateId,responseDeclaration,' +
  'interactionTypes,interactions,name,solutions,editorState,media,remarks,' +
  'evidence,hints,instructions,outcomeDeclaration,isPartialScore,evalUnordered';

/**
 * Read a single question with the old editor's field list. `extraFields`
 * mirrors the old leafFormConfig field codes appended per category
 * definition (isReviewModificationAllowed is always appended, as the old
 * editor did).
 */
export async function readQuestion(
  questionId: string,
  extraFields: string[] = [],
): Promise<Record<string, unknown>> {
  const fields = [READ_QUESTION_FIELDS, ...extraFields, 'isReviewModificationAllowed'].join(',');
  // mode: 'edit' — if a Draft .img (working-copy) node already exists for a
  // published question, its versionKey is the one that must be sent back on
  // update (versionCheckMode is on); a plain read would return the Live
  // node's versionKey instead, which update would then reject as stale.
  const response = await apiClient.get(`${URLS.question.read}/${questionId}`, {
    params: { mode: 'edit', fields },
  });
  return (response.data?.result?.question ?? {}) as Record<string, unknown>;
}

/** Old editor's question list (search by identifiers) — used by previews. */
export async function listQuestions(questionIds: string[]): Promise<Array<Record<string, unknown>>> {
  if (questionIds.length === 0) return [];
  const response = await apiClient.post(URLS.question.list, {
    request: { search: { identifier: questionIds } },
  });
  return (response.data?.result?.questions ?? []) as Array<Record<string, unknown>>;
}

export async function deleteQuestion(questionId: string): Promise<void> {
  await apiClient.delete(`${URLS.question.retire}/${questionId}`);
}

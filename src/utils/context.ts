import type { IContext, EditorMode } from '../types/editor';

// The sunbird portal host passes the OLD Angular editor contract
// (context.user.id, context.identifier); standalone hosts may pass
// userId/contentId directly. Normalize both here.

export function getUserId(ctx?: IContext | null): string {
  return ctx?.user?.id ?? ctx?.userId ?? ctx?.uid ?? '';
}

export function getContentId(ctx?: IContext | null): string {
  return ctx?.identifier ?? ctx?.contentId ?? '';
}

/** Old editor sends context.user.fullName as the asset `creator`. */
export function getUserFullName(ctx?: IContext | null): string {
  const user = ctx?.user as { fullName?: string; firstName?: string; lastName?: string } | undefined;
  return user?.fullName
    ?? [user?.firstName, user?.lastName].filter(Boolean).join(' ');
}

/**
 * Old editor's role rule (header.component handleActionButtons): content is
 * editable in edit mode, or during org/sourcing review when the host allows
 * reviewer modifications (context.enableReviewEdit).
 */
export function isEditingAllowed(mode: EditorMode, ctx?: IContext | null): boolean {
  if (mode === 'edit') return true;
  return (mode === 'orgreview' || mode === 'sourcingreview') && !!ctx?.enableReviewEdit;
}

/** Dynamic Assess is scoped to this primaryCategory, not to whether skill happens to be set. */
export const DYNAMIC_ASSESS_QUESTIONSET_CATEGORY = 'Dynamic QuestionSet';

export function isDynamicAssessQuestionSet(primaryCategory?: string | null): boolean {
  return primaryCategory === DYNAMIC_ASSESS_QUESTIONSET_CATEGORY;
}

/** The set's category: the host's config value when given, else the loaded root's own, so a host that omits it can't switch the Dynamic guards off. */
export function resolvePrimaryCategory(
  configCategory: string | null | undefined,
  root: { primaryCategory?: string; metadata?: Record<string, unknown> } | undefined,
): string | undefined {
  return configCategory ?? root?.primaryCategory ?? (root?.metadata?.primaryCategory as string | undefined);
}

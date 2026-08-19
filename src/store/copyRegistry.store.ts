import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Tracks question identifiers created via the Library sidebar's "Copy"
 * action. A copy is a fully independent, visibility:"Default" question
 * (so its own future edits stay isolated — see question-edit-isolation-
 * options.md), but it's meant to be private to whichever questionset it
 * was copied into, not independently discoverable/reusable like a normal
 * Library question. There's no backend field to key this off (visibility
 * can't distinguish a copy from an original, since both are "Default"),
 * so this is a lightweight, localStorage-persisted client-side registry:
 *  - useLibrary.ts filters copies out of search results.
 *  - QuestionDetail.tsx only offers "Open in editor" for a copy.
 */
interface CopyRegistryState {
  copiedIds: Record<string, true>;
  markAsCopy: (identifier: string) => void;
  isCopy: (identifier: string) => boolean;
}

export const useCopyRegistryStore = create<CopyRegistryState>()(
  persist(
    (set, get) => ({
      copiedIds: {},
      markAsCopy: (identifier) =>
        set((state) => ({ copiedIds: { ...state.copiedIds, [identifier]: true } })),
      isCopy: (identifier) => !!get().copiedIds[identifier],
    }),
    { name: 'sb-editor-copied-questions' },
  ),
);

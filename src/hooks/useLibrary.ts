import { useCallback, useEffect, useRef } from 'react';
import { useLibraryStore } from '../store/library.store';
import { useEditorStore } from '../store/editor.store';
import { useCopyRegistryStore } from '../store/copyRegistry.store';
import { compositeSearch } from '../api/content';
import type { LibraryFilters } from '../store/library.store';

const PAGE_SIZE = 20;

// Module-level, not per-hook-instance — every caller (the LibraryDock panel
// AND imperative refreshes from elsewhere, e.g. after a question is
// created) must share one sequence counter. Two independent counters would
// let a stale response from one caller land after a newer request from the
// other, since neither would recognize the other's requestId as current.
let requestSeq = 0;

async function loadLibrary(
  channel: string,
  query = '',
  filter = 'all',
  advancedFilters: LibraryFilters = {},
  reset = true,
  sortAZ = false,
): Promise<void> {
  const requestId = ++requestSeq;
  const state = useLibraryStore.getState();
  state.setLoading(true);
  try {
    const filters: Record<string, unknown> = { status: ['Live'] };
    if (filter && filter !== 'all') filters['primaryCategory'] = [filter];
    if (advancedFilters?.board?.length) filters['board'] = advancedFilters.board;
    if (advancedFilters?.medium?.length) filters['medium'] = advancedFilters.medium;
    if (advancedFilters?.gradeLevel?.length) filters['gradeLevel'] = advancedFilters.gradeLevel;
    if (advancedFilters?.subject?.length) filters['subject'] = advancedFilters.subject;

    const currentOffset = reset ? 0 : state.offset;
    const { content, count } = await compositeSearch({
      filters,
      query,
      limit: query ? 50 : PAGE_SIZE,
      offset: currentOffset,
      channel: channel || undefined,
      sortBy: sortAZ ? { name: 'asc' } : { lastUpdatedOn: 'desc' },
    });

    if (requestId !== requestSeq) return; // stale response — a newer load superseded it
    // Copies (see copyRegistry.store.ts) are visibility:"Default" so their
    // own future edits stay isolated, but they're private to whichever
    // questionset they were copied into — never independently discoverable.
    const { isCopy } = useCopyRegistryStore.getState();
    const filtered = content.filter((item) => !isCopy(item.identifier));
    if (reset) state.setContent(filtered, count, content.length);
    else state.appendContent(filtered, count, content.length);
  } catch (e) {
    console.error('[useLibrary] load error:', e);
  } finally {
    if (requestId === requestSeq) useLibraryStore.getState().setLoading(false);
  }
}

/**
 * Re-run the library search with whatever query/filter is currently active —
 * e.g. after a new standalone question is created, so it shows up without
 * the user having to re-search manually. Callable from outside a component
 * (not a hook), unlike `useLibrary()`'s `refetch`.
 */
export function refreshLibrary(): void {
  const channel = useEditorStore.getState().editorConfig?.context?.channel ?? '';
  const { searchQuery, activeFilter, advancedFilters, sortAZ } = useLibraryStore.getState();
  void loadLibrary(channel, searchQuery, activeFilter, advancedFilters, true, sortAZ);
}

export function useLibrary() {
  const store = useLibraryStore();
  const channel = useEditorStore((s) => s.editorConfig?.context?.channel ?? '');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Clear a pending debounced search on unmount so it can't fire into the
  // global library store after the panel closes.
  useEffect(() => () => clearTimeout(searchTimerRef.current), []);

  const load = useCallback(
    (
      query = '',
      filter = 'all',
      advancedFilters: LibraryFilters = {},
      reset = true,
      sortAZ = false,
    ) => loadLibrary(channel, query, filter, advancedFilters, reset, sortAZ),
    [channel],
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  const search = useCallback(
    (query: string) => {
      store.setSearch(query);
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(
        () => load(query, store.activeFilter, store.advancedFilters, true, store.sortAZ),
        300,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.activeFilter, store.advancedFilters, store.sortAZ, load],
  );

  const setFilter = useCallback(
    (filter: string) => {
      store.setFilter(filter);
      load(store.searchQuery, filter, store.advancedFilters, true, store.sortAZ);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.searchQuery, store.advancedFilters, store.sortAZ, load],
  );

  const applyAdvancedFilters = useCallback(
    (advancedFilters: LibraryFilters) => {
      store.setAdvancedFilters(advancedFilters);
      load(store.searchQuery, store.activeFilter, advancedFilters, true, store.sortAZ);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.searchQuery, store.activeFilter, store.sortAZ, load],
  );

  const toggleSort = useCallback(() => {
    const next = !store.sortAZ;
    store.setSortAZ(next);
    load(store.searchQuery, store.activeFilter, store.advancedFilters, true, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.sortAZ, store.searchQuery, store.activeFilter, store.advancedFilters, load]);

  const loadMore = useCallback(() => {
    if (store.isLoading) return;
    load(store.searchQuery, store.activeFilter, store.advancedFilters, false, store.sortAZ);
  }, [store.isLoading, store.searchQuery, store.activeFilter, store.advancedFilters, store.sortAZ, load]);

  return {
    content: store.filteredContent,
    isLoading: store.isLoading,
    totalCount: store.totalCount,
    activeFilter: store.activeFilter,
    advancedFilters: store.advancedFilters,
    searchQuery: store.searchQuery,
    sortAZ: store.sortAZ,
    hasMore: store.allContent.length < store.totalCount,
    search,
    setFilter,
    applyAdvancedFilters,
    toggleSort,
    loadMore,
    refetch: () => load(store.searchQuery, store.activeFilter, store.advancedFilters, true, store.sortAZ),
  };
}

import { QueryClient } from '@tanstack/react-query';

// Single instance shared by QuestionsetEditor's <QueryClientProvider> and
// any plain (non-hook) code that needs to read an already-fetched query's
// cache directly — e.g. useSaveQuestion.ts reading a framework's categories
// without re-fetching. Kept in its own module (not QuestionsetEditor.tsx)
// so importing it can't create a circular dependency with the component tree.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

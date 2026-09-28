import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getSetupLevelsComments,
  updateSetupLevelsComments,
  type SetupLevelsComments,
} from "@/features/admin/systemApi";

export const SETUP_CONFIG_QUERY_KEY = ["setup-levels-comments"];

/**
 * Fetches the current Setup Levels and Comments configuration (Cosmos DB).
 * Any authenticated user may read it; the Result page and Reports use it.
 */
export function useSetupConfig(enabled = true) {
  return useQuery({
    queryKey: SETUP_CONFIG_QUERY_KEY,
    queryFn: () => getSetupLevelsComments(),
    enabled,
    // Keep the setup configuration available when administrators navigate
    // between settings pages. The page can render cached values immediately,
    // while a stale query is refreshed in the background.
    staleTime: 60_000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}

/**
 * Persists a configuration change (administrator only — enforced server-side)
 * and refreshes the cached configuration on success.
 */
export function useUpdateSetupConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Pick<SetupLevelsComments, "levels" | "comments">) =>
      updateSetupLevelsComments(data),
    onSuccess: (saved) => {
      queryClient.setQueryData<SetupLevelsComments>(SETUP_CONFIG_QUERY_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: SETUP_CONFIG_QUERY_KEY });
    },
  });
}
/** Every request the dashboard makes, as TanStack Query hooks, so caching and refetching live in one place. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { CollectionResponse, SyncRun, SyncRunsResponse } from "../src/api-types";
import { ApiError, api } from "./api";

export const keys = {
  collection: ["collection"] as const,
  syncRuns: ["sync-runs"] as const,
  records: ["records"] as const,
};

export function useCollection() {
  return useQuery({ queryKey: keys.collection, queryFn: () => api<CollectionResponse>("/collection") });
}

export function useSyncRuns(limit = 20) {
  return useQuery({
    queryKey: [...keys.syncRuns, limit],
    queryFn: () => api<SyncRunsResponse>(`/sync/runs?limit=${limit}`).then((r) => r.runs),
  });
}

/** Run a sync, or preview one. A sync Discogs refused is still a result to show, not an error. */
export function useSync() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ dryRun = false, forceRemovals = false }: { dryRun?: boolean; forceRemovals?: boolean }) => {
      const query = new URLSearchParams();
      if (dryRun) query.set("dry_run", "true");
      if (forceRemovals) query.set("force_removals", "true");
      try {
        return await api<SyncRun>(`/sync/discogs?${query}`, { method: "POST" });
      } catch (error) {
        if (error instanceof ApiError && error.status === 502 && error.body) return error.body as SyncRun;
        throw error;
      }
    },
    onSettled: (run) => {
      void client.invalidateQueries({ queryKey: keys.syncRuns });
      if (run && !run.dry_run) {
        void client.invalidateQueries({ queryKey: keys.collection });
        void client.invalidateQueries({ queryKey: keys.records });
      }
    },
  });
}

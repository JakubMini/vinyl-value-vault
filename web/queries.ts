/** Every request the dashboard makes, as TanStack Query hooks, so caching and refetching live in one place. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ApiRecord, CollectionResponse, ListedRecord, QueueResponse, RecordDetail, RecordsPage, SyncRun, SyncRunsResponse } from "../src/api-types";
import { ApiError, api } from "./api";

export const keys = {
  collection: ["collection"] as const,
  syncRuns: ["sync-runs"] as const,
  records: ["records"] as const,
};

/** The total and counts, with `days` of daily totals for the chart. Switching range keeps the old chart until the new one arrives. */
export function useCollection(days = 30) {
  return useQuery({
    queryKey: [...keys.collection, days],
    queryFn: () => api<CollectionResponse>(`/collection?days=${days}`),
    placeholderData: keepPreviousData,
  });
}

/** Waiting in the valuation queue: a record the job can price that has no price time. */
export function isQueued(r: ListedRecord): boolean {
  return r.last_valued_at === null && r.discogs_release_id !== null && r.discogs_removed_at === null;
}

/**
 * The whole collection in one request, each record's change measured over `changeDays`; the
 * table sorts and filters it in the browser. While records are queued it refreshes once a
 * minute, so prices appear as the job reaches them (only while the tab is in view: a list costs
 * about three D1 rows read per record, five with a window other than 30 days). Switching window
 * keeps the old list on screen until the new one arrives.
 */
export function useRecords(changeDays = 30) {
  return useQuery({
    queryKey: [...keys.records, changeDays],
    queryFn: () => api<RecordsPage>(`/records?limit=1000&change_days=${changeDays}`).then((r) => r.records),
    refetchInterval: (query) => (query.state.data?.some(isQueued) ? 60_000 : false),
    placeholderData: keepPreviousData,
  });
}

/** Send records to the front of the valuation queue. The job prices them a batch at a time. */
export function useQueueRevalue() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api<QueueResponse>("/valuations/queue", { method: "POST", json: { ids } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.records }),
  });
}

export function useRecord(id: number) {
  return useQuery({ queryKey: ["record", id], queryFn: () => api<RecordDetail>(`/records/${id}`) });
}

export type RevalueOutcome =
  | { status: "valued"; recordId: number; valueMinor: number; method: "price_suggestion" | "lowest_listing" }
  | { status: "unpriced"; recordId: number; reason: string };

/** Ask Discogs for a price now. Discogs refusing (often, from Cloudflare) is an error the page explains. */
export function useRevalue(id: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ outcome: RevalueOutcome; record: ApiRecord }>(`/records/${id}/revalue`, { method: "POST" }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["record", id] });
      void client.invalidateQueries({ queryKey: keys.records });
      void client.invalidateQueries({ queryKey: keys.collection });
    },
  });
}

export function useDeleteRecord() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<null>(`/records/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.records });
      void client.invalidateQueries({ queryKey: keys.collection });
    },
  });
}

export type RecordPatch = Partial<Pick<ApiRecord, "media_condition" | "sleeve_condition" | "purchase_price_minor" | "purchase_currency" | "purchased_on" | "notes" | "spotify_album_id">>;

/**
 * Change a record. Every cached list (one per change window) updates at once and is put back
 * if the server says no; the server's answer then replaces the guess, since a new media grade
 * also changes the value.
 */
export function useUpdateRecord() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: RecordPatch }) => api<ApiRecord>(`/records/${id}`, { method: "PATCH", json: patch }),
    onMutate: async ({ id, patch }) => {
      await client.cancelQueries({ queryKey: keys.records });
      const before = client.getQueriesData<ListedRecord[]>({ queryKey: keys.records });
      client.setQueriesData<ListedRecord[]>({ queryKey: keys.records }, (rows) => rows?.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      return { before };
    },
    onError: (_error, _vars, context) => {
      for (const [key, rows] of context?.before ?? []) client.setQueryData(key, rows);
    },
    onSettled: (_data, _error, { id }) => {
      void client.invalidateQueries({ queryKey: keys.records });
      void client.invalidateQueries({ queryKey: keys.collection });
      void client.invalidateQueries({ queryKey: ["record", id] });
    },
  });
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

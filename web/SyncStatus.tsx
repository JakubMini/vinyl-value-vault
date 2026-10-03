/** How the last Discogs sync went, as a dot and a few words on the right of the header. */
import { NavLink } from "react-router";

import type { SyncRun } from "../src/api-types";
import { dateTime, timeAgo } from "./format";
import { useSyncRuns } from "./queries";

type Tone = "good" | "warning" | "none";

/** "just now", "12m ago", "24h ago", "3d ago": short enough for the header. */
function shortAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 48 * 3600) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

/** What the header says about a run: the words shown, the words read out, and the colour of the dot. */
function describe(run: SyncRun | null | undefined): { text: string; label: string; title?: string; tone: Tone } {
  if (run === undefined) return { text: "Sync", label: "Discogs sync", tone: "none" };
  if (run === null) return { text: "Not synced yet", label: "Discogs sync: none has run yet", tone: "none" };
  if (run.status === "running") return { text: "Syncing…", label: "Discogs sync running now", tone: "none" };
  const at = run.finished_at ?? run.started_at;
  const ago = shortAgo(at);
  const exact = dateTime(at);
  switch (run.status) {
    case "ok":
      return { text: `Synced ${ago}`, label: `Discogs sync finished ${timeAgo(at)}`, title: `Last Discogs sync: ${exact}`, tone: "good" };
    case "partial":
      return { text: `Sync stopped ${ago}`, label: `Discogs sync stopped early ${timeAgo(at)}`, title: `Last Discogs sync stopped early: ${exact}`, tone: "warning" };
    case "failed":
      return { text: `Sync failed ${ago}`, label: `Discogs sync failed ${timeAgo(at)}`, title: `Last Discogs sync failed: ${exact}`, tone: "warning" };
  }
}

/**
 * Green when the last sync finished, amber when it stopped early or failed, grey when there has
 * never been one. Previews do not count. Links to the sync page; on a narrow screen only the dot
 * shows, and the link still says everything to a screen reader.
 */
export function SyncStatus() {
  // The same list the sync page shows, so the two share one request and refresh together after a sync.
  const runs = useSyncRuns();
  const last = runs.data ? (runs.data.find((r) => !r.dry_run) ?? null) : undefined;
  const s = describe(last);
  return (
    <NavLink to="/sync" className="sync-status" aria-label={`${s.label}. Open the sync page.`} title={s.title}>
      <span className={`sync-dot sync-dot-${s.tone}`} aria-hidden="true" />
      <span className="sync-status-text">{s.text}</span>
    </NavLink>
  );
}

/** Small pieces shared across pages. */
import type { ReactNode } from "react";

import type { SyncRun } from "../src/api-types";
import { ApiError } from "./api";
import { dateTime, timeAgo } from "./format";

const STATUS: Record<SyncRun["status"], { label: string; icon: string; tone: string }> = {
  ok: { label: "Done", icon: "✓", tone: "good" },
  partial: { label: "Stopped early", icon: "!", tone: "warning" },
  failed: { label: "Failed", icon: "✕", tone: "critical" },
  running: { label: "Running", icon: "…", tone: "neutral" },
};

/** A status never relies on colour alone: icon, label and tone together. */
export function StatusBadge({ status }: { status: SyncRun["status"] }) {
  const s = STATUS[status];
  return (
    <span className={`badge badge-${s.tone}`}>
      <span aria-hidden="true">{s.icon}</span>
      {s.label}
    </span>
  );
}

/** "3 minutes ago", with the exact time on hover. */
export function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={dateTime(iso)}>
      {timeAgo(iso)}
    </time>
  );
}

export function Tile({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {detail ? <div className="tile-detail">{detail}</div> : null}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const unauthorised = error instanceof ApiError && error.status === 401;
  return (
    <div className="notice notice-critical" role="alert">
      <strong>{unauthorised ? "Not signed in." : "Something went wrong."}</strong>{" "}
      {unauthorised
        ? import.meta.env.DEV
          ? "In development, put the API key in .env.development.local as VITE_DEV_API_KEY and restart."
          : "Reload the page to sign in again."
        : error instanceof Error
          ? error.message
          : String(error)}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <p className="muted" aria-live="polite">
      {label}…
    </p>
  );
}

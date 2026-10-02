import { env, exports } from "cloudflare:workers";
import { type JsonBodyType, http, HttpResponse } from "msw";
import { expect } from "vitest";

import { network } from "./network";

export const AUTH = { Authorization: "Bearer test-api-key" };

/** Call the Worker as a client would, through its real fetch handler. */
export async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return exports.default.fetch(new Request(`https://vault.test${path}`, init));
}

/** An API call: the path is relative to /api, and the key and an optional JSON body are added. */
export async function api(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  for (const [k, v] of Object.entries(AUTH)) headers.set(k, v);
  let body = rest.body;
  if (json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(json);
  }
  return rawFetch(`/api${path}`, { ...rest, headers, body });
}

export async function resetDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM valuations"),
    env.DB.prepare("DELETE FROM collection_snapshots"),
    env.DB.prepare("DELETE FROM records"),
  ]);
}

// Discogs mocks. Each is one-shot and tracked, so a test can assert every expected call happened.
const DISCOGS = "https://api.discogs.com";
const pending = new Set<string>();

function mockOnce(url: string, body: JsonBodyType, status: number, headers: Record<string, string>): void {
  pending.add(url);
  network.use(
    http.get(
      url,
      () => {
        pending.delete(url);
        return HttpResponse.json(body, { status, headers });
      },
      { once: true },
    ),
  );
}

export function mockStats(releaseId: number, body: JsonBodyType, status = 200, headers: Record<string, string> = {}): void {
  mockOnce(`${DISCOGS}/marketplace/stats/${releaseId}`, body, status, headers);
}

export function mockSuggestions(releaseId: number, body: JsonBodyType, status = 200): void {
  mockOnce(`${DISCOGS}/marketplace/price_suggestions/${releaseId}`, body, status, {});
}

export function mockRelease(releaseId: number, body: JsonBodyType, status = 200): void {
  mockOnce(`${DISCOGS}/releases/${releaseId}`, body, status, {});
}

/** For afterEach: every mock registered during the test must have been hit. */
export function expectAllMocksUsed(): void {
  const unused = [...pending];
  pending.clear();
  expect(unused, "Discogs calls that were expected but never made").toEqual([]);
}

/** A record inserted straight into D1, bypassing the API and its inline valuation. */
export async function seedRecord(fields: {
  artist: string;
  title: string;
  discogs_release_id?: number;
  media_condition?: string;
  last_valued_at?: string;
}): Promise<{ id: number }> {
  const row = await env.DB.prepare(
    `INSERT INTO records (artist, title, discogs_release_id, media_condition, last_valued_at)
     VALUES (?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(fields.artist, fields.title, fields.discogs_release_id ?? null, fields.media_condition ?? "VG+", fields.last_valued_at ?? null)
    .first<{ id: number }>();
  if (!row) throw new Error("seed failed");
  return row;
}

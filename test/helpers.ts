import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { type JsonBodyType, http, HttpResponse } from "msw";
import { expect } from "vitest";

import worker from "../src/index";
import type { ListedRecord } from "../src/api-types";
import type { CollectionItem } from "../src/release";
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
    env.DB.prepare("DELETE FROM collection_daily"),
    env.DB.prepare("DELETE FROM records"),
    env.DB.prepare("DELETE FROM sync_runs"),
    env.DB.prepare("DELETE FROM sync_ignored"),
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

// The Discogs collection. One user, with the default collection fields.
export const DISCOGS_USER = "vault-owner";
export const COLLECTION_FIELDS = { media: 1, sleeve: 2, notes: 3 };

export function mockIdentity(status = 200): void {
  mockOnce(`${DISCOGS}/oauth/identity`, status === 200 ? { username: DISCOGS_USER } : { message: "You must authenticate" }, status, {});
}

export function mockFields(): void {
  mockOnce(
    `${DISCOGS}/users/${DISCOGS_USER}/collection/fields`,
    {
      fields: [
        { id: COLLECTION_FIELDS.media, name: "Media Condition" },
        { id: COLLECTION_FIELDS.sleeve, name: "Sleeve Condition" },
        { id: COLLECTION_FIELDS.notes, name: "Notes" },
      ],
    },
    200,
    {},
  );
}

/**
 * One page of the collection. Pages share a URL and differ only by ?page=, which MSW does not
 * match on, so the handler checks the page itself and falls through when it is not its turn.
 */
export function mockCollectionPage(
  page: number,
  releases: CollectionItem[],
  options: { pages?: number; status?: number; headers?: Record<string, string> } = {},
): void {
  const key = `collection page ${page}`;
  pending.add(key);
  network.use(
    http.get(`${DISCOGS}/users/${DISCOGS_USER}/collection/folders/0/releases`, ({ request }) => {
      if (!pending.has(key) || new URL(request.url).searchParams.get("page") !== String(page)) return undefined;
      pending.delete(key);
      const pages = options.pages ?? 1;
      return HttpResponse.json(
        { pagination: { page, pages, items: releases.length }, releases },
        { status: options.status ?? 200, headers: options.headers ?? {} },
      );
    }),
  );
}

/** Mock a whole sync: identity, fields, then one page per array. */
export function mockCollection(...pages: CollectionItem[][]): void {
  mockIdentity();
  mockFields();
  pages.forEach((releases, i) => mockCollectionPage(i + 1, releases, { pages: pages.length }));
}

/** A vinyl item in the Discogs collection. */
export function collectionItem(
  instanceId: number,
  overrides: {
    releaseId?: number;
    artist?: string;
    title?: string;
    format?: string;
    media?: string;
    sleeve?: string;
    notes?: string;
    cover?: string;
    genres?: string[];
    styles?: string[];
  } = {},
): CollectionItem {
  const releaseId = overrides.releaseId ?? instanceId + 1_000_000;
  const notes = [
    overrides.media ? { field_id: COLLECTION_FIELDS.media, value: overrides.media } : null,
    overrides.sleeve ? { field_id: COLLECTION_FIELDS.sleeve, value: overrides.sleeve } : null,
    overrides.notes ? { field_id: COLLECTION_FIELDS.notes, value: overrides.notes } : null,
  ].filter((n) => n !== null);
  return {
    id: releaseId,
    instance_id: instanceId,
    date_added: "2026-09-01T10:00:00-07:00",
    basic_information: {
      id: releaseId,
      title: overrides.title ?? `Album ${instanceId}`,
      year: 1994,
      artists: [{ name: overrides.artist ?? `Artist ${instanceId}`, join: "" }],
      labels: [{ name: "Go! Discs", catno: `CAT ${instanceId}` }],
      formats: [{ name: overrides.format ?? "Vinyl", qty: "1", descriptions: ["LP", "Album"] }],
      cover_image: overrides.cover ?? `https://i.discogs.com/${instanceId}-cover.jpg`,
      thumb: `https://i.discogs.com/${instanceId}-thumb.jpg`,
      ...(overrides.genres ? { genres: overrides.genres } : {}),
      ...(overrides.styles ? { styles: overrides.styles } : {}),
    },
    notes,
  };
}

/** For afterEach: every mock registered during the test must have been hit. */
export function expectAllMocksUsed(): void {
  const unused = [...pending];
  pending.clear();
  expect(unused, "Discogs calls that were expected but never made").toEqual([]);
}

/** The most recent five-minute mark: a tick the pool road, the default in tests, acts on. */
export function lastFiveMinuteMark(): Date {
  return new Date(Math.floor(Date.now() / 300_000) * 300_000);
}

/** One cron tick through the real scheduled handler, scheduled for `at`. */
export async function cronTick(at: Date = lastFiveMinuteMark(), tickEnv: Env = env): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron: "* * * * *", scheduledTime: at }), tickEnv, ctx);
  await waitOnExecutionContext(ctx);
}

/** Record a successful collection sync, so the next cron tick prices records instead of syncing. */
export async function markSyncedRecently(): Promise<void> {
  await env.DB.prepare("INSERT INTO sync_runs (started_at, finished_at, source, status) VALUES (?1, ?1, 'cron', 'ok')")
    .bind(new Date().toISOString())
    .run();
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

/** A record as the collection list returns it, for testing the pure selection and insight logic without a database. */
export function listedRecord(overrides: Partial<ListedRecord> = {}): ListedRecord {
  return {
    id: 1,
    discogs_release_id: 1,
    discogs_instance_id: 1,
    artist: "Artist",
    title: "Title",
    label: null,
    catalogue_number: null,
    year: null,
    country: null,
    format: null,
    genres: [],
    styles: [],
    media_condition: "VG+",
    sleeve_condition: "VG+",
    purchase_price_minor: null,
    purchase_currency: null,
    purchased_on: null,
    notes: null,
    current_value_minor: null,
    current_currency: null,
    current_value: null,
    last_valued_at: null,
    last_valuation_error: null,
    current_method: null,
    current_lowest_listing_minor: null,
    current_num_for_sale: null,
    cover_image_url: null,
    thumb_url: null,
    discogs_added_at: null,
    discogs_removed_at: null,
    spotify_album_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    change_30d_minor: null,
    // The window's figure is the 30-day one unless a test says otherwise, as the API does by default.
    change_minor: overrides.change_30d_minor ?? null,
    gain_minor: null,
    ...overrides,
  };
}

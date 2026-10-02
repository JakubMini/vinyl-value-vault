import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { spotifyAlbumId, spotifySearchUrl } from "../src/spotify";
import { syncCollection } from "../src/sync";
import { api, collectionItem, expectAllMocksUsed, mockCollection, resetDatabase, seedRecord } from "./helpers";

const ID = "1ATL5GLyefJaxhQzSPVrLX";

beforeEach(resetDatabase);
afterEach(expectAllMocksUsed);

describe("reading a Spotify album from what Spotify lets you share", () => {
  it.each([
    [ID],
    [`https://open.spotify.com/album/${ID}`],
    [`https://open.spotify.com/album/${ID}?si=Xh3k2PqRS0aBcD`],
    [`https://open.spotify.com/intl-de/album/${ID}`],
    [`spotify:album:${ID}`],
    [`  https://open.spotify.com/album/${ID}/  `],
  ])("finds the album in %s", (input) => {
    expect(spotifyAlbumId(input)).toBe(ID);
  });

  it.each([
    ["a track link", `https://open.spotify.com/track/${ID}`],
    ["a playlist link", `https://open.spotify.com/playlist/${ID}`],
    ["another site", `https://example.com/album/${ID}`],
    ["plain http", `http://open.spotify.com/album/${ID}`],
    ["an id of the wrong length", "1ATL5GLyefJaxhQzSPVr"],
    ["anything else", "Nevermind"],
  ])("rejects %s", (_, input) => {
    expect(spotifyAlbumId(input)).toBeNull();
  });

  it("searches for artist and title", () => {
    expect(spotifySearchUrl("Portishead", "Dummy / Live")).toBe("https://open.spotify.com/search/Portishead%20Dummy%20%2F%20Live");
  });
});

describe("pinning a record to a Spotify album", () => {
  it("stores the album id from a pasted link, and unpins with null", async () => {
    const record = await seedRecord({ artist: "Portishead", title: "Dummy" });

    const pinned = await api(`/records/${record.id}`, { method: "PATCH", json: { spotify_album_id: `https://open.spotify.com/album/${ID}?si=abc` } });
    expect(pinned.status).toBe(200);
    expect(await pinned.json()).toMatchObject({ spotify_album_id: ID });

    const unpinned = await api(`/records/${record.id}`, { method: "PATCH", json: { spotify_album_id: null } });
    expect(await unpinned.json()).toMatchObject({ spotify_album_id: null });
  });

  it("refuses something that is not an album", async () => {
    const record = await seedRecord({ artist: "Portishead", title: "Dummy" });
    const res = await api(`/records/${record.id}`, { method: "PATCH", json: { spotify_album_id: `https://open.spotify.com/track/${ID}` } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("Spotify album link");
  });

  it("survives a sync with Discogs", async () => {
    mockCollection([collectionItem(1, { title: "Dummy" })]);
    await syncCollection(env, { source: "api" });
    const { id } = (await env.DB.prepare("SELECT id FROM records").first<{ id: number }>())!;
    await api(`/records/${id}`, { method: "PATCH", json: { spotify_album_id: ID } });

    mockCollection([collectionItem(1, { title: "Dummy (Remastered)" })]);
    expect(await syncCollection(env, { source: "api" })).toMatchObject({ updated: 1 });

    const after = await env.DB.prepare("SELECT title, spotify_album_id FROM records WHERE id = ?").bind(id).first();
    expect(after).toEqual({ title: "Dummy (Remastered)", spotify_album_id: ID });
  });
});

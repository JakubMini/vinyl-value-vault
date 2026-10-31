import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DeviceCode, DeviceToken, LinkedDevice, NfcTag, RecordsPage } from "../src/api-types";
import { api, expectAllMocksUsed, rawFetch, resetDatabase, seedRecord } from "./helpers";

beforeEach(resetDatabase);
afterEach(expectAllMocksUsed);

/** As the gateway forwards it: no API key, no Access token. */
function screen(path: string, init: { method?: string; token?: string; json?: unknown } = {}): Promise<Response> {
  const headers = new Headers();
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  return rawFetch(`/api${path}`, { method: init.method ?? "GET", headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
}

const requestCode = async () => (await screen("/device/code", { method: "POST" })).json<DeviceCode>();
const poll = (device_code: string) => screen("/device/token", { method: "POST", json: { device_code } });
const approve = (user_code: string) => api("/devices/approve", { method: "POST", json: { user_code } });

/** A screen linked end to end, holding its token. */
async function linkedScreen(): Promise<string> {
  const code = await requestCode();
  expect((await approve(code.user_code)).status).toBe(200);
  return (await (await poll(code.device_code)).json<DeviceToken>()).access_token;
}

describe("linking a screen", () => {
  it("runs the whole device flow", async () => {
    await seedRecord({ artist: "Oasis", title: "Definitely Maybe" });

    const res = await screen("/device/code", { method: "POST" });
    expect(res.status).toBe(200);
    const code = await res.json<DeviceCode>();
    expect(code.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(code).toMatchObject({
      verification_uri: "https://vault.jakubszypicyn.com/link",
      verification_uri_complete: `https://vault.jakubszypicyn.com/link?code=${code.user_code}`,
      expires_in: 600,
      interval: 5,
    });

    const pending = await poll(code.device_code);
    expect(pending.status).toBe(400);
    expect(await pending.json()).toEqual({ error: "authorization_pending" });

    expect((await approve(code.user_code)).status).toBe(200);

    const issued = await poll(code.device_code);
    expect(issued.status).toBe(200);
    const token = await issued.json<DeviceToken>();
    expect(token.token_type).toBe("Bearer");
    expect(token.access_token).toMatch(/^vvd_[A-Za-z0-9_-]{43}$/);

    const records = await screen("/records", { token: token.access_token });
    expect(records.status).toBe(200);
    expect((await records.json<RecordsPage>()).records.map((r) => r.title)).toEqual(["Definitely Maybe"]);

    const again = await poll(code.device_code);
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "invalid_grant" });

    // Neither the device code nor the token is stored as given.
    const row = await env.DB.prepare("SELECT device_code_hash, token_hash FROM devices").first<{ device_code_hash: string; token_hash: string }>();
    expect(row?.device_code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses an expired code, and an unknown one", async () => {
    const code = await requestCode();
    await env.DB.prepare("UPDATE devices SET expires_at = ?").bind(new Date(Date.now() - 1000).toISOString()).run();

    expect((await approve(code.user_code)).status).toBe(404);
    const expired = await poll(code.device_code);
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({ error: "expired_token" });
    expect(await (await poll("made-up")).json()).toEqual({ error: "expired_token" });
  });

  it("caps the codes waiting at five, and clears expired ones first", async () => {
    for (let i = 0; i < 5; i++) expect((await screen("/device/code", { method: "POST" })).status).toBe(200);
    expect((await screen("/device/code", { method: "POST" })).status).toBe(429);

    await env.DB.prepare("UPDATE devices SET expires_at = ?").bind(new Date(Date.now() - 1000).toISOString()).run();
    expect((await screen("/device/code", { method: "POST" })).status).toBe(200);
  });

  it("approves a code typed in any case, with or without the dash", async () => {
    const first = await requestCode();
    expect((await approve(first.user_code.toLowerCase())).status).toBe(200);
    const second = await requestCode();
    expect((await approve(second.user_code.replace("-", ""))).status).toBe(200);
    expect((await approve("BBBB-BBBB")).status).toBe(404);
  });
});

describe("a linked screen", () => {
  it("may only read records, change their grades and use tags", async () => {
    const token = await linkedScreen();
    const { id } = await seedRecord({ artist: "Blur", title: "Parklife" });

    expect((await screen(`/records/${id}`, { token })).status).toBe(200);
    const refused: [string, string][] = [
      ["GET", "/collection"],
      ["POST", "/sync/discogs"],
      ["DELETE", `/records/${id}`],
      ["GET", "/devices"],
      ["POST", "/devices/approve"],
    ];
    for (const [method, path] of refused) {
      expect((await screen(path, { method, token })).status, `${method} ${path}`).toBe(403);
    }
    expect((await api(`/records/${id}`)).status).toBe(200);
  });

  it("may change grades but nothing else", async () => {
    const token = await linkedScreen();
    const { id } = await seedRecord({ artist: "Pulp", title: "Different Class" });

    const notes = await screen(`/records/${id}`, { method: "PATCH", token, json: { notes: "signed" } });
    expect(notes.status).toBe(400);
    const mixed = await screen(`/records/${id}`, { method: "PATCH", token, json: { sleeve_condition: "VG", notes: "signed" } });
    expect(mixed.status).toBe(400);

    const sleeve = await screen(`/records/${id}`, { method: "PATCH", token, json: { sleeve_condition: "VG" } });
    expect(sleeve.status).toBe(200);
    expect(await sleeve.json()).toMatchObject({ sleeve_condition: "VG", notes: null });
  });

  it("is listed, and loses access once revoked", async () => {
    const token = await linkedScreen();
    await requestCode(); // still pending, so not listed

    const { devices } = await (await api("/devices")).json<{ devices: LinkedDevice[] }>();
    expect(devices).toHaveLength(1);
    expect(Object.keys(devices[0] ?? {}).sort()).toEqual(["approved_at", "created_at", "id"]);

    expect((await api(`/devices/${devices[0]?.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await screen("/records", { token })).status).toBe(401);
    expect((await api(`/devices/${devices[0]?.id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("is refused with a made-up token", async () => {
    expect((await screen("/records", { token: "vvd_made-up" })).status).toBe(401);
  });
});

describe("NFC tags", () => {
  const assign = (uid: string, record_id: number, token: string) => screen(`/tags/${uid}`, { method: "PUT", token, json: { record_id } });

  it("points a tag at a record, and finds it from another screen", async () => {
    const token = await linkedScreen();
    const { id } = await seedRecord({ artist: "Bonobo", title: "Migration" });

    expect((await screen("/tags/04C67BA5892681", { token })).status).toBe(404);
    const res = await assign("04c67ba5892681", id, token);
    expect(res.status).toBe(200);
    expect(await res.json<NfcTag>()).toEqual({ uid: "04C67BA5892681", record_id: id });

    const other = await linkedScreen();
    const found = await screen("/tags/04C67BA5892681", { token: other });
    expect(found.status).toBe(200);
    expect(await found.json<NfcTag>()).toEqual({ uid: "04C67BA5892681", record_id: id });
  });

  it("lets a record have several tags, and moves a tag when it is assigned again", async () => {
    const token = await linkedScreen();
    const first = await seedRecord({ artist: "Massive Attack", title: "Mezzanine" });
    const second = await seedRecord({ artist: "Portishead", title: "Dummy" });

    await assign("04AABBCCDDEEFF", first.id, token);
    await assign("04112233445566", first.id, token);
    for (const uid of ["04AABBCCDDEEFF", "04112233445566"]) {
      expect((await (await screen(`/tags/${uid}`, { token })).json<NfcTag>()).record_id).toBe(first.id);
    }
    await assign("04112233445566", second.id, token);
    expect((await (await screen("/tags/04112233445566", { token })).json<NfcTag>()).record_id).toBe(second.id);
  });

  it("refuses a malformed tag or a record that doesn't exist, and forgets tags of a deleted record", async () => {
    const token = await linkedScreen();
    const { id } = await seedRecord({ artist: "Air", title: "Moon Safari" });

    expect((await screen("/tags/not-a-tag", { token })).status).toBe(400);
    expect((await assign("04C67B", id, token)).status).toBe(400);
    expect((await assign("04C67BA5892681", id + 1000, token)).status).toBe(404);
    expect((await screen(`/tags/04C67BA5892681`, { method: "PUT", token, json: { record_id: "1" } })).status).toBe(400);

    await assign("04C67BA5892681", id, token);
    expect((await api(`/records/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await screen("/tags/04C67BA5892681", { token })).status).toBe(404);
  });

  it("needs a token", async () => {
    expect((await screen("/tags/04C67BA5892681")).status).toBe(401);
  });
});

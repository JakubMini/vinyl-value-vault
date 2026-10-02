import { sign } from "hono/jwt";
import { http, HttpResponse } from "msw";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { forgetAccessKeys } from "../src/access";
import { rawFetch } from "./helpers";
import { network } from "./network";

// Matches ACCESS_TEAM_DOMAIN and ACCESS_AUD in vitest.config.ts.
const TEAM = "https://vault-test.cloudflareaccess.com";
const AUD = "test-access-aud";
const CERTS = `${TEAM}/cdn-cgi/access/certs`;

let privateJwk: JsonWebKey;
let publicJwk: JsonWebKey;
let certFetches = 0;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  privateJwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
});

beforeEach(() => {
  forgetAccessKeys();
  certFetches = 0;
  serveCerts();
});

function serveCerts(status = 200): void {
  network.use(
    http.get(CERTS, () => {
      certFetches++;
      return status === 200 ? HttpResponse.json({ keys: [{ ...publicJwk, kid: "k1", alg: "RS256" }] }) : new HttpResponse(null, { status });
    }),
  );
}

/** A token as Access would issue it, with any claim overridable. */
async function accessToken(claims: Record<string, unknown> = {}, kid = "k1"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: [AUD], iss: TEAM, sub: "user-1", email: "owner@example.com", type: "app", iat: now, nbf: now, exp: now + 600, ...claims };
  return sign(payload, { ...privateJwk, kid, alg: "RS256" } as Parameters<typeof sign>[1], "RS256");
}

const withAccess = (token: string) => rawFetch("/api/collection", { headers: { "Cf-Access-Jwt-Assertion": token } });

describe("signing in through Cloudflare Access", () => {
  it("lets in a request with a valid Access token", async () => {
    expect((await withAccess(await accessToken())).status).toBe(200);
  });

  it("fetches the signing keys once and reuses them", async () => {
    await withAccess(await accessToken());
    await withAccess(await accessToken());
    expect(certFetches).toBe(1);
  });

  it.each([
    ["for another application", { aud: ["someone-else"] }],
    ["from another team", { iss: "https://intruder.cloudflareaccess.com" }],
    ["that has expired", { exp: Math.floor(Date.now() / 1000) - 60 }],
    ["with no expiry", { exp: undefined }],
  ])("refuses a token %s", async (_, claims) => {
    expect((await withAccess(await accessToken(claims))).status).toBe(401);
  });

  it("refuses a token signed with a key Access does not have", async () => {
    expect((await withAccess(await accessToken({}, "unknown-key"))).status).toBe(401);
  });

  it("refuses a token whose signature does not match", async () => {
    const token = await accessToken();
    const [header, payload] = token.split(".");
    const forged = `${header}.${payload}.${"A".repeat(342)}`;
    expect((await withAccess(forged)).status).toBe(401);
  });

  it("refuses something that is not a token", async () => {
    expect((await withAccess("not-a-jwt")).status).toBe(401);
  });

  it("answers 503 when Access's keys cannot be fetched", async () => {
    serveCerts(500);
    const res = await withAccess(await accessToken());
    expect(res.status).toBe(503);
  });
});

describe("the API key", () => {
  it("still works on its own", async () => {
    expect((await rawFetch("/api/collection", { headers: { Authorization: "Bearer test-api-key" } })).status).toBe(200);
  });

  it("is checked on its own merits even when an Access token is present", async () => {
    const res = await rawFetch("/api/collection", {
      headers: { Authorization: "Bearer wrong", "Cf-Access-Jwt-Assertion": await accessToken() },
    });
    expect(res.status).toBe(401);
  });

  it("is required when there is no Access token", async () => {
    const res = await rawFetch("/api/collection");
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
  });
});

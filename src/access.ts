/**
 * Signing in through Cloudflare Access.
 *
 * With Access switched on for the workers.dev hostname, a browser only reaches the Worker
 * after logging in, and every request carries a signed JWT in Cf-Access-Jwt-Assertion. The
 * Worker still verifies it: Access can be switched off, or misconfigured, and a header on its
 * own proves nothing.
 *
 * Why not ctx.access: the runtime can hand a Worker the verified identity, but a Worker that
 * serves static assets sits behind an internal router that does not pass it through.
 */
import { decode, verifyWithJwks } from "hono/jwt";
import type { HonoJsonWebKey } from "hono/utils/jwt/jws";

export interface AccessConfig {
  /** https://<team>.cloudflareaccess.com: the token's issuer, and where its signing keys live. */
  teamDomain: string;
  /** The Access application's audience tag. */
  aud: string;
}

/** Access's signing keys could not be fetched, so no token can be checked. Answer 503, not 401. */
export class AccessUnavailable extends Error {
  override name = "AccessUnavailable";
}

const KEYS_TTL_MS = 10 * 60_000;
const REFETCH_FLOOR_MS = 60_000;

// Access's public signing keys, cached per isolate. They are public, change rarely, and are the
// same for every request, so this is not request state; it saves a subrequest on almost every
// call. An unknown key id triggers a refetch (Access rotates keys), at most once a minute so a
// stream of made-up key ids cannot turn into a stream of subrequests.
let cache: { url: string; keys: HonoJsonWebKey[]; fetchedAt: number } | null = null;

/** For tests: forget the cached keys. */
export function forgetAccessKeys(): void {
  cache = null;
}

async function signingKeys(teamDomain: string, kid: string): Promise<HonoJsonWebKey[]> {
  const url = `${teamDomain.replace(/\/$/, "")}/cdn-cgi/access/certs`;
  const age = cache && cache.url === url ? Date.now() - cache.fetchedAt : Infinity;
  const known = cache?.keys.some((k) => k.kid === kid) ?? false;
  if (cache && age < KEYS_TTL_MS && (known || age < REFETCH_FLOOR_MS)) return cache.keys;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new AccessUnavailable(`Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new AccessUnavailable(`${url} answered ${response.status}`);
  const body = (await response.json()) as { keys?: unknown };
  if (!Array.isArray(body.keys)) throw new AccessUnavailable(`${url} returned no keys`);
  cache = { url, keys: body.keys as HonoJsonWebKey[], fetchedAt: Date.now() };
  return cache.keys;
}

/**
 * True when the token is a current Access JWT for this application: RS256, signed by one of the
 * team's keys, issued by the team domain, for this audience, and not expired. Throws
 * AccessUnavailable when the keys cannot be fetched.
 */
export async function verifyAccessJwt(token: string, config: AccessConfig): Promise<boolean> {
  let kid: string | undefined;
  try {
    kid = decode(token).header.kid;
  } catch {
    return false;
  }
  if (!kid) return false;

  const keys = await signingKeys(config.teamDomain, kid);
  try {
    const payload = await verifyWithJwks(token, {
      keys,
      allowedAlgorithms: ["RS256"],
      verification: { iss: config.teamDomain.replace(/\/$/, ""), aud: config.aud },
    });
    // Hono skips the expiry check when the claim is missing. Access always sets it; insist.
    return typeof payload.exp === "number";
  } catch {
    return false;
  }
}

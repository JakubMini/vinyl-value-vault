// Secrets are not in wrangler.jsonc, so `wrangler types` cannot know about them.
// They are merged into the generated Env here. All are set with
// `wrangler secret put` in production and in .dev.vars locally.
interface VaultSecrets {
  /** Bearer token every client must present. */
  API_KEY: string;
  /** Discogs personal access token. Empty means unauthenticated calls only. */
  DISCOGS_TOKEN: string;
  /**
   * Which road Discogs calls take: "tunnel" or "pool" (the default). Not secret, but kept as a
   * secret so that `npm run egress:*` can switch it without a deploy, and a deploy cannot
   * switch it back. See discogsRoad() in src/valuation.ts.
   */
  DISCOGS_ROAD?: string;
}

interface Env extends VaultSecrets {}

declare namespace Cloudflare {
  interface Env extends VaultSecrets {}
}

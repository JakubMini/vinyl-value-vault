// Secrets are not in wrangler.jsonc, so `wrangler types` cannot know about them.
// They are merged into the generated Env here. Both are set with
// `wrangler secret put` in production and in .dev.vars locally.
interface VaultSecrets {
  /** Bearer token every client must present. */
  API_KEY: string;
  /** Discogs personal access token. Empty means unauthenticated calls only. */
  DISCOGS_TOKEN: string;
}

interface Env extends VaultSecrets {}

declare namespace Cloudflare {
  interface Env extends VaultSecrets {}
}

import { setupNetwork } from "@msw/cloudflare";

/** One Mock Service Worker network per test file. Handlers are added per test with `network.use`. */
export const network = setupNetwork();

import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One build for the whole app: the React dashboard (index.html, web/) becomes static assets,
// and the Worker (src/index.ts, per wrangler.jsonc) is bundled alongside it. `vite dev` runs
// both, the Worker inside workerd with a local D1. Tests use vitest.config.ts, not this file.
// Remote bindings stay off: locally DISCOGS_ROAD is unset, so the vault takes the pool road and
// never touches the DISCOGS_EGRESS VPC service, which would otherwise need a live session.
export default defineConfig({
  plugins: [react(), cloudflare({ remoteBindings: false })],
});

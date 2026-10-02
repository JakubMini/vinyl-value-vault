import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside the Workers runtime (workerd) against a real local D1, with
// the migrations in ./migrations applied by test/apply-migrations.ts.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url)));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        // The DISCOGS_EGRESS VPC service would otherwise open a session to the real account.
        // Tests never leave the machine: tunnel-road tests pass in their own egress binding.
        remoteBindings: false,
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            API_KEY: "test-api-key",
            DISCOGS_TOKEN: "test-discogs-token",
            ACCESS_TEAM_DOMAIN: "https://vault-test.cloudflareaccess.com",
            ACCESS_AUD: "test-access-aud",
          },
        },
      };
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts", "./test/setup-network.ts"],
  },
});

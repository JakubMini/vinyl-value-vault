import { applyD1Migrations, env } from "cloudflare:test";

// Runs once per test file, against that file's isolated D1.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

# Vinyl Value Vault: working agreement

Rules for anyone (human or Claude) changing this repo. Read before touching code.

## Branches, commits, pull requests

- **Never commit to main.** Every piece of work, however small, gets its own branch cut from an
  up-to-date main and lands through a pull request. Fixing a typo in the README is a branch too.
- Branch names say what the branch is for: `feat/<thing>`, `fix/<thing>`, `chore/<thing>`, `docs/<thing>`.
- Start every task with: `git switch main && git pull --ff-only && git switch -c <branch>`.
- One PR, one purpose. If you notice something unrelated, note it and open a separate branch later.
- Commit subjects are imperative and under 72 characters. Say what changed; say why when it is not obvious.
- Run `npm run check` (types, typecheck, tests) before pushing. CI must be green before merging.
- The PR body says what changed, how it was verified, and whether the README needed updating.

## The README is for humans

- The README is the front door. It is written for someone deciding in two minutes whether this
  project, and the person behind it, are worth their attention: often a technical recruiter or a
  hiring engineer. It must explain what the project does, how it works, why the stack was chosen,
  how to run it, how work is done here, and where it is heading.
- Keep it true. Any PR that changes the architecture, data model, API, setup steps, cost profile,
  engineering practice or roadmap updates the README in the same PR. Stale docs are a bug.
- Plain English first, code second. Explain decisions, not just facts. Short sentences.
- Do not inflate. Say what is built and tested, what is deployed, and what is still an idea.

## Stack and conventions

- TypeScript in strict mode on Cloudflare Workers. Hono for HTTP, Zod for validation, D1 (SQLite)
  for storage, Cron Triggers for the valuation job, Vitest running inside workerd for tests.
- Money is stored as integers in minor units (pence). Times are ISO-8601 UTC strings. Condition
  grades use the Goldmine scale: M, NM, VG+, VG, G+, G, F, P.
- Where things live: SQL only in `src/db.ts`; routes in `src/app.ts`; Discogs calls in
  `src/discogs.ts`; the job in `src/valuation.ts`; the Worker entry in `src/index.ts`.
- Migrations in `migrations/` are append-only. Add a new numbered file; never edit one that may
  already have been applied anywhere.
- Config lives in `wrangler.jsonc`. After changing bindings or vars run `npm run types`. The generated
  `worker-configuration.d.ts` is not committed: it is produced on `npm install` and by `npm run check`. Secret names and their types are declared in
  `src/env.d.ts`; secret values are never in the repo (`.dev.vars` locally, `wrangler secret put` in
  production).
- Respect the Workers free-plan budget: at most 50 outbound fetches and 10 ms CPU per invocation.
  A valuation batch is 20 records (two Discogs calls each). Change `VALUATION_BATCH_SIZE` only with
  a reason written down.
- Discogs is rate limited to 60 requests a minute. Always send the User-Agent, always read the
  rate-limit headers, stop early rather than get throttled.
- Behaviour changes come with tests. Tests mock Discogs at the network layer with Mock Service Worker (`test/helpers.ts`) and never touch the internet.
- Logs are structured JSON: `console.log(JSON.stringify({ event: "...", ... }))`.
- Follow Cloudflare's Workers best practices: no request state in module scope, no floating
  promises, `ctx.waitUntil` for background work, timing-safe secret comparison (Hono's bearerAuth
  does this), explicit error handling rather than `passThroughOnException`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Local Worker with a local D1. `curl localhost:8787/__scheduled` runs the cron handler. |
| `npm run check` | Regenerate types, typecheck, run tests. Run before every push. |
| `npm test` | Tests only. |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply migrations locally / in production. |
| `npm run deploy` | Deploy to Cloudflare. |

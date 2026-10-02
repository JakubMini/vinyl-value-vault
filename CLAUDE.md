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

## Cloudflare account: check it first

- This machine is logged in to one of two Cloudflare accounts. The vault lives only on the
  **personal account, jakub.m.szypicyn@gmail.com**. The work account, jakub@blueskyip.com, must
  never be used for this project: do not deploy, migrate, set secrets or create resources there.
- Before any wrangler command that touches Cloudflare (deploy, `d1 ... --remote`, `secret`, `tail`),
  run `npx wrangler whoami` and confirm it names jakub.m.szypicyn@gmail.com. If it names anything
  else, stop and ask Jakub to switch: `npx wrangler logout && npx wrangler login`. Never log in on
  Jakub's behalf.
- Run wrangler from this repo's root, so it uses this project's `wrangler.jsonc` and Worker name.
- Treat a failed migrate or deploy as a stop. Do not run imports or anything else against the live
  vault until both have succeeded on the right account.

## Stack and conventions

- TypeScript in strict mode on Cloudflare Workers. Hono for HTTP, Zod for validation, D1 (SQLite)
  for storage, Cron Triggers for the valuation job and the daily collection sync, Vitest running
  inside workerd for tests. The dashboard is React built by Vite (`@cloudflare/vite-plugin`) and
  served by the same Worker as static assets.
- Money is stored as integers in minor units (pence). Times are ISO-8601 UTC strings. Condition
  grades use the Goldmine scale: M, NM, VG+, VG, G+, G, F, P.
- Where things live: SQL only in `src/db.ts`; routes in `src/app.ts`; Discogs calls in
  `src/discogs.ts`; Discogs-to-record mapping in `src/release.ts`; the valuation job in
  `src/valuation.ts`; the Discogs collection sync in `src/sync.ts`; Cloudflare Access token checks in
  `src/access.ts`; the Worker entry in
  `src/index.ts`; the dashboard in `web/` (with `index.html` at the root and static files in
  `public/`), sharing response types through `src/api-types.ts`, which must stay free of Worker
  types; laptop-side tools, if ever needed, in `scripts/`, run with Node directly.
- Discogs owns what a pressing is (artist, title, label, year, format, artwork); the vault owns
  what is said about the copy (grades, notes, purchase details). A sync only ever writes the
  former to existing records. Keep it that way.
- Migrations in `migrations/` are append-only. Add a new numbered file; never edit one that may
  already have been applied anywhere.
- Config lives in `wrangler.jsonc`. After changing bindings or vars run `npm run types`. The generated
  `worker-configuration.d.ts` is not committed: it is produced on `npm install` and by `npm run check`. Secret names and their types are declared in
  `src/env.d.ts`; secret values are never in the repo (`.dev.vars` locally, `wrangler secret put` in
  production).
- Respect the Workers free-plan budget: at most 50 outbound fetches and 10 ms CPU per invocation.
  The cron runs every minute on a batch of 5 records (two Discogs calls each), skipping records priced
  within `VALUATION_REFRESH_HOURS`. Once a day the tick runs the collection sync instead (2 calls plus
  one per 100 items). Change `VALUATION_BATCH_SIZE` only with a reason written down.
- Discogs is rate limited to 60 requests a minute. Always send the User-Agent, always read the
  rate-limit headers, stop early rather than get throttled.
- Behaviour changes come with tests. Tests mock Discogs at the network layer with Mock Service Worker (`test/helpers.ts`) and never touch the internet.
- Logs are structured JSON: `console.log(JSON.stringify({ event: "...", ... }))`.
- Follow Cloudflare's Workers best practices: no request state in module scope, no floating
  promises, `ctx.waitUntil` for background work, timing-safe secret comparison (`timingSafeEqual`
  from `hono/utils/buffer`), explicit error handling rather than `passThroughOnException`. The one
  module-scope cache is Access's public signing keys in `src/access.ts`: shared by every request,
  not request state.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite: the dashboard at localhost:5173 plus the Worker with a local D1. The dashboard needs `VITE_DEV_API_KEY` in `.env.development.local`. `curl localhost:5173/cdn-cgi/local/scheduled` runs the cron handler. |
| `npm run build` | Build the dashboard and the Worker into `dist/`. Plain `wrangler dev` / `wrangler deploy` need this first. |
| `npm run check` | Regenerate types, typecheck, run tests. Run before every push. |
| `npm test` | Tests only. |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply migrations locally / in production. |
| `npm run deploy` | Build, then deploy to Cloudflare. |

The Discogs collection syncs itself once a day. To sync now, `POST /api/sync/discogs` (add
`?dry_run=true` to preview); see the README.

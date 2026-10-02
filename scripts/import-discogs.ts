/**
 * Import a Discogs collection into the vault.
 *
 *   node scripts/import-discogs.ts [--url <vault url>] [--dry-run]
 *
 * Reads DISCOGS_TOKEN and API_KEY from the environment, or from .dev.vars.
 * Safe to re-run: every record remembers its Discogs collection item, and
 * items already in the vault are skipped. Records are created without an
 * immediate price (?value=false); the valuation cron prices them a few at a
 * time, every minute, inside Discogs' rate limit.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { type CollectionFieldIds, type CollectionItem, collectionItemToRecord, isVinyl } from "../src/release.ts";

const DEFAULT_URL = "https://vinyl-value-vault.jakub-m-szypicyn.workers.dev";
const USER_AGENT = "VinylValueVault/0.1 +https://github.com/JakubMini/vinyl-value-vault";

const { values: args } = parseArgs({
  options: { url: { type: "string", default: DEFAULT_URL }, "dry-run": { type: "boolean", default: false } },
});
const vaultUrl = args.url!.replace(/\/$/, "");
const dryRun = args["dry-run"]!;

function secret(name: string): string {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  try {
    const line = readFileSync(".dev.vars", "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
    const value = line?.slice(name.length + 1).trim();
    if (value) return value;
  } catch {
    // fall through
  }
  throw new Error(`${name} is not set. Put it in the environment or in .dev.vars.`);
}

const discogsToken = secret("DISCOGS_TOKEN");
const apiKey = dryRun ? "" : secret("API_KEY");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function discogs<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.discogs.com${path}`, {
      headers: { Authorization: `Discogs token=${discogsToken}`, "User-Agent": USER_AGENT },
    });
    if (res.status === 429 && attempt < 3) {
      await sleep(60_000);
      continue;
    }
    if (!res.ok) throw new Error(`Discogs ${res.status} for ${path}: ${await res.text()}`);
    if (Number(res.headers.get("X-Discogs-Ratelimit-Remaining") ?? "60") < 5) await sleep(15_000);
    return (await res.json()) as T;
  }
}

async function vault(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${vaultUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...init.headers },
  });
}

// 1. Whose collection, and which fields hold the condition grades.
const { username } = await discogs<{ username: string }>("/oauth/identity");
const { fields } = await discogs<{ fields: { id: number; name: string }[] }>(`/users/${username}/collection/fields`);
const fieldId = (name: string) => fields.find((f) => f.name.toLowerCase() === name)?.id;
const fieldIds: CollectionFieldIds = { media: fieldId("media condition"), sleeve: fieldId("sleeve condition"), notes: fieldId("notes") };

// 2. Every item in the collection.
const items: CollectionItem[] = [];
for (let page = 1; ; page++) {
  const body = await discogs<{ pagination: { pages: number }; releases: CollectionItem[] }>(
    `/users/${username}/collection/folders/0/releases?per_page=100&page=${page}&sort=added&sort_order=asc`,
  );
  items.push(...body.releases);
  if (page >= body.pagination.pages) break;
}

const vinyl = items.filter(isVinyl);
const notVinyl = items.filter((i) => !isVinyl(i));
console.log(`Discogs user ${username}: ${items.length} items, ${vinyl.length} on vinyl.`);
for (const i of notVinyl) {
  const info = i.basic_information;
  console.log(`  skipping, not vinyl: ${info.artists?.[0]?.name ?? "?"} - ${info.title} (${info.formats?.map((f) => f.name).join(", ")})`);
}

if (dryRun) {
  for (const item of vinyl) console.log(JSON.stringify(collectionItemToRecord(item, fieldIds)));
  console.log(`Dry run: would import up to ${vinyl.length} records into ${vaultUrl}.`);
  process.exit(0);
}

// 3. What the vault already has, so a re-run only adds what is new.
const existing = new Set<number>();
for (let offset = 0; ; offset += 200) {
  const res = await vault(`/records?limit=200&offset=${offset}`);
  if (!res.ok) throw new Error(`Vault ${res.status} listing records: ${await res.text()}`);
  const body = (await res.json()) as { records: { discogs_instance_id: number | null }[]; total: number };
  for (const r of body.records) if (r.discogs_instance_id !== null) existing.add(r.discogs_instance_id);
  if (offset + 200 >= body.total) break;
}

// 4. Add the rest.
let created = 0;
let skipped = 0;
const failed: string[] = [];
for (const item of vinyl) {
  if (existing.has(item.instance_id)) {
    skipped++;
    continue;
  }
  const record = collectionItemToRecord(item, fieldIds);
  const res = await vault("/records?value=false", { method: "POST", body: JSON.stringify(record) });
  if (res.status === 201) created++;
  else if (res.status === 409) skipped++;
  else failed.push(`${record.artist} - ${record.title}: ${res.status} ${await res.text()}`);
}

console.log(`Created ${created}, already there ${skipped}, failed ${failed.length}.`);
for (const f of failed) console.log(`  failed: ${f}`);
if (created > 0) console.log("The valuation cron prices a few records every minute; check GET /collection.");
process.exit(failed.length > 0 ? 1 : 0);

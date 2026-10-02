/**
 * The road the vault's Discogs calls take out of Cloudflare, managed from a laptop.
 * See README, "The road to Discogs".
 *
 *   npm run egress:here     Make this machine the vault's way out to Discogs, and put the vault on
 *                           the tunnel road: a run every minute, from this machine's address.
 *   npm run egress:pool     Put the vault back on Cloudflare's shared address (a run every five
 *                           minutes), and stop being the way out if this machine was.
 *   npm run egress:status   Which road the vault is on, and which machines the tunnel has.
 *   npm run egress:remove   Stop being the way out, on a laptop being retired. Leaves the road.
 *
 * Moving to a new laptop: `npm run egress:here` on the new one, then `npm run egress:remove` on
 * the old one. Needs macOS (the connector runs as a launchd agent), Homebrew for cloudflared, and
 * `npx wrangler login` on the vault's Cloudflare account, which every command checks first.
 *
 * Run with Node directly: `node scripts/egress.ts <command>`.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The only account the vault may use (CLAUDE.md, "Cloudflare account: check it first"). */
const ACCOUNT_EMAIL = "jakub.m.szypicyn@gmail.com";
const WORKER = "vinyl-value-vault";
/** The Cloudflare Tunnel behind the DISCOGS_EGRESS VPC service in wrangler.jsonc. */
const TUNNEL = "vinyl-vault-egress";
const LABEL = "com.vinyl-value-vault.discogs-egress";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const wranglerBin = join(repo, "node_modules", ".bin", "wrangler");
const supportDir = join(homedir(), "Library", "Application Support", "vinyl-value-vault");
/** The connector token. Whoever holds it can stand in as the way out, so it stays private. */
const tokenFile = join(supportDir, "tunnel-token");
const plistFile = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const logFile = join(homedir(), "Library", "Logs", "vinyl-value-vault-egress.log");

type Road = "tunnel" | "pool";
interface CloudflareResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}
interface Tunnel {
  id: string;
  name: string;
  status: string;
}
interface Connector {
  id: string;
  arch: string;
  version: string;
  run_at: string;
  conns: { origin_ip: string; colo_name: string }[];
}
/** A `valuation.batch`, `sync.run` or `scheduled.failed` log line from the Worker. */
interface RunLine {
  event: string;
  road?: Road;
  [key: string]: unknown;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function wrangler(args: string[], input?: string): { ok: boolean; stdout: string; stderr: string } {
  if (!existsSync(wranglerBin)) fail("Wrangler is not installed here. Run `npm install` in the repo first.");
  const result = spawnSync(wranglerBin, args, { cwd: repo, encoding: "utf8", input });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Wrangler prints a banner before its JSON. */
function jsonFrom<T>(output: string): T {
  const start = output.indexOf("{");
  if (start < 0) fail(`Expected JSON from wrangler, got:\n${output}`);
  return JSON.parse(output.slice(start)) as T;
}

/** Confirms wrangler is logged in to the vault's account and returns the account id. */
function checkAccount(): string {
  const whoami = wrangler(["whoami", "--json"]);
  const user = jsonFrom<{ loggedIn: boolean; email?: string; accounts?: { id: string; name: string }[] }>(whoami.stdout || "{}");
  if (!user.loggedIn) fail("Wrangler is not logged in. Run `npx wrangler login` with the vault's Cloudflare account.");
  if (user.email !== ACCOUNT_EMAIL) {
    fail(`Wrangler is logged in as ${user.email}, but the vault lives on ${ACCOUNT_EMAIL}.\n  Run \`npx wrangler logout && npx wrangler login\` and choose that account.`);
  }
  const accounts = user.accounts ?? [];
  if (accounts.length !== 1) fail(`Expected one Cloudflare account for ${ACCOUNT_EMAIL}, found ${accounts.length}.`);
  console.log(`✓ Wrangler is on ${ACCOUNT_EMAIL}`);
  return accounts[0]!.id;
}

let apiToken: string | undefined;

async function cloudflare<T>(accountId: string, path: string): Promise<T> {
  apiToken ??= jsonFrom<{ token: string }>(wrangler(["auth", "token", "--json"]).stdout).token;
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  const body = (await response.json()) as CloudflareResponse<T>;
  if (!body.success) fail(`Cloudflare API ${path} failed: ${body.errors.map((e) => e.message).join("; ")}`);
  return body.result;
}

async function findTunnel(accountId: string): Promise<Tunnel> {
  const tunnels = await cloudflare<Tunnel[]>(accountId, `/cfd_tunnel?name=${TUNNEL}&is_deleted=false`);
  const tunnel = tunnels[0];
  if (!tunnel) fail(`The tunnel "${TUNNEL}" does not exist. See README, "Setting up the road from scratch".`);
  return tunnel;
}

function connectors(accountId: string, tunnel: Tunnel): Promise<Connector[]> {
  return cloudflare<Connector[]>(accountId, `/cfd_tunnel/${tunnel.id}/connections`);
}

function describeConnector(c: Connector, local: string | undefined): string {
  const where = c.conns[0] ? `${c.conns[0].origin_ip} via ${c.conns[0].colo_name}` : "no live connections";
  const mine = c.id === local ? "  ← this machine" : "";
  return `  ${where}, cloudflared ${c.version} on ${c.arch}, up since ${c.run_at}${mine}`;
}

/** The connector id cloudflared logged when this machine's agent last started. */
function localConnectorId(): string | undefined {
  if (!existsSync(logFile)) return undefined;
  const ids = [...readFileSync(logFile, "utf8").matchAll(/Generated Connector ID: ([0-9a-f-]{36})/g)];
  return ids.at(-1)?.[1];
}

function requireMac(): void {
  if (process.platform !== "darwin") {
    fail(`This command installs a macOS launchd agent. Elsewhere, run the connector as a service yourself:\n  cloudflared tunnel --no-autoupdate run --token-file <file holding the token>`);
  }
}

function launchctl(...args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync("launchctl", args, { encoding: "utf8" });
  return { ok: result.status === 0, stdout: result.stdout ?? "" };
}

const domain = () => `gui/${process.getuid?.() ?? fail("Cannot tell which user this is.")}`;

function agentRunning(): boolean {
  const printed = launchctl("print", `${domain()}/${LABEL}`);
  return printed.ok && /state = running/.test(printed.stdout);
}

function cloudflaredPath(): string {
  const found = spawnSync("which", ["cloudflared"], { encoding: "utf8" });
  if (found.status === 0) return found.stdout.trim();
  if (spawnSync("which", ["brew"]).status !== 0) fail("cloudflared is not installed and Homebrew is not available to install it.");
  console.log("Installing cloudflared with Homebrew…");
  if (spawnSync("brew", ["install", "cloudflared"], { stdio: "inherit" }).status !== 0) fail("brew install cloudflared failed.");
  return cloudflaredPath();
}

function plist(cloudflared: string): string {
  const args = [cloudflared, "tunnel", "--no-autoupdate", "run", "--token-file", tokenFile];
  const xml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- The vault's way out to Discogs. Installed by scripts/egress.ts in vinyl-value-vault. -->
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(logFile)}</string>
  <key>StandardErrorPath</key><string>${xml(logFile)}</string>
</dict>
</plist>
`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Installs (or reinstalls) the connector as a launchd agent and waits until it is connected. */
async function startAgent(token: string): Promise<void> {
  const cloudflared = cloudflaredPath();
  mkdirSync(supportDir, { recursive: true, mode: 0o700 });
  writeFileSync(tokenFile, token, { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
  mkdirSync(dirname(plistFile), { recursive: true });
  mkdirSync(dirname(logFile), { recursive: true });
  writeFileSync(plistFile, plist(cloudflared));

  launchctl("bootout", `${domain()}/${LABEL}`); // not loaded yet is fine
  const logStart = existsSync(logFile) ? statSync(logFile).size : 0;
  if (!launchctl("bootstrap", domain(), plistFile).ok) fail(`launchctl could not start ${plistFile}.`);

  for (let waited = 0; waited < 30; waited++) {
    await sleep(1000);
    const fresh = existsSync(logFile) ? readFileSync(logFile, "utf8").slice(logStart) : "";
    if (/Registered tunnel connection/.test(fresh)) {
      console.log(`✓ cloudflared is connected, running as a launchd agent (starts at login, restarts if it stops)`);
      return;
    }
  }
  fail(`cloudflared did not connect within 30 seconds. Its log: ${logFile}`);
}

/** Stops and removes this machine's connector. Returns whether there was one. */
function stopAgent(): boolean {
  const had = existsSync(plistFile) || existsSync(tokenFile);
  launchctl("bootout", `${domain()}/${LABEL}`);
  rmSync(plistFile, { force: true });
  rmSync(tokenFile, { force: true });
  return had;
}

function setRoad(road: Road): void {
  const put = wrangler(["secret", "put", "DISCOGS_ROAD", "--name", WORKER], road);
  if (!put.ok) fail(`Could not set DISCOGS_ROAD:\n${put.stderr || put.stdout}`);
  console.log(`✓ The vault is on the ${road} road (DISCOGS_ROAD=${road})`);
}

// The tail takes several seconds to connect and says nothing when it has, and each deployed
// version's cron fires at its own second past the minute. Two minutes always includes one
// whole minute of listening, so on the tunnel road a run is never missed.
const RUN_WINDOW_MS = 120_000;

/**
 * Tails the Worker until its next run logs a line, or `timeoutMs` passes. On the tunnel road a
 * run logs every minute; on the pool road only every fifth minute.
 */
function nextRun(timeoutMs: number): Promise<RunLine | null> {
  return new Promise((resolve) => {
    const tail = spawn(wranglerBin, ["tail", WORKER, "--format", "json"], { cwd: repo });
    let buffer = "";
    const finish = (line: RunLine | null) => {
      clearTimeout(timer);
      tail.kill();
      resolve(line);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    tail.stdout.setEncoding("utf8");
    tail.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      // Each event is a pretty-printed JSON object whose closing brace sits alone on a line.
      let end: number;
      while ((end = buffer.indexOf("\n}\n")) >= 0) {
        const text = buffer.slice(buffer.indexOf("{"), end + 2);
        buffer = buffer.slice(end + 3);
        try {
          const event = JSON.parse(text) as { logs?: { message: unknown[] }[] };
          for (const log of event.logs ?? []) {
            for (const message of log.message) {
              if (typeof message !== "string" || !message.startsWith("{")) continue;
              const line = JSON.parse(message) as RunLine;
              if (["valuation.batch", "sync.run", "scheduled.failed"].includes(line.event)) return finish(line);
            }
          }
        } catch {
          // Not a complete event yet, or not one of ours.
        }
      }
    });
  });
}

function describeRun(line: RunLine): string {
  if (line.event === "valuation.batch") {
    const outcome = line.stoppedEarly ? `stopped early: ${String(line.reason)}` : "finished";
    return `Priced ${Number(line.valued)} of ${Number(line.considered)} due records (${outcome}). Discogs allowance left: ${line.rateLimitRemaining ?? "no call made"}.`;
  }
  if (line.event === "sync.run") return `Synced the collection: ${String(line.status)}${line.note ? `, ${String(line.note)}` : ""}.`;
  return `The run failed: ${String(line.error)}.`;
}

async function here(): Promise<void> {
  requireMac();
  const accountId = checkAccount();
  const tunnel = await findTunnel(accountId);
  const local = agentRunning() ? localConnectorId() : undefined;
  const others = (await connectors(accountId, tunnel)).filter((c) => c.id !== local);
  if (others.length > 0) {
    console.warn(`! Another machine is connected to the tunnel too:\n${others.map((c) => describeConnector(c, undefined)).join("\n")}`);
    console.warn("  Cloudflare would split the vault's calls between the machines. Run `npm run egress:remove` there.");
  }

  const token = await cloudflare<string>(accountId, `/cfd_tunnel/${tunnel.id}/token`);
  await startAgent(token);
  setRoad("tunnel");

  console.log("Waiting for the next run (up to two minutes)…");
  const run = await nextRun(RUN_WINDOW_MS);
  if (!run) fail("No run was logged within two minutes. Check `npm run egress:status`.");
  if (run.road === undefined) {
    console.warn("! The deployed Worker does not know about roads yet. Deploy the current main (`npm run deploy`),");
    console.warn("  then check `npm run egress:status`. This machine's connector is ready for it.");
    return;
  }
  if (run.road !== "tunnel") fail(`The run took the ${run.road} road. Check \`npm run egress:status\` in a minute.`);
  console.log(`✓ ${describeRun(run)}`);
  console.log("\nThis machine is the vault's way out to Discogs. Prices refresh while it is awake.");
}

async function pool(): Promise<void> {
  checkAccount();
  setRoad("pool");
  if (process.platform === "darwin" && stopAgent()) console.log("✓ Stopped and removed this machine's tunnel connector");
  console.log("\nThe vault is on Cloudflare's shared address: a run every five minutes, up to 5 records.");
  console.log("To come back to the tunnel: `npm run egress:here`.");
}

async function remove(): Promise<void> {
  requireMac();
  console.log(stopAgent() ? "✓ Stopped and removed this machine's tunnel connector" : "This machine was not running the tunnel's connector.");
  const accountId = checkAccount();
  await sleep(5000); // let Cloudflare notice the connector has gone
  const left = await connectors(accountId, await findTunnel(accountId));
  if (left.length === 0) {
    console.warn("! No machine is connected to the tunnel now. On the tunnel road, pricing waits until");
    console.warn("  `npm run egress:here` runs somewhere, or `npm run egress:pool` moves the vault back to the pool.");
  }
}

async function status(): Promise<void> {
  const accountId = checkAccount();
  const tunnel = await findTunnel(accountId);
  const local = process.platform === "darwin" && agentRunning() ? localConnectorId() : undefined;
  const list = await connectors(accountId, tunnel);
  console.log(`\nTunnel ${tunnel.name}: ${tunnel.status}, ${list.length} machine${list.length === 1 ? "" : "s"} connected`);
  for (const c of list) console.log(describeConnector(c, local));
  if (process.platform === "darwin") console.log(`This machine's agent: ${agentRunning() ? "running" : existsSync(plistFile) ? "installed, not running" : "not installed"}`);

  console.log("\nWaiting for the next run to see the road (up to two minutes)…");
  const run = await nextRun(RUN_WINDOW_MS);
  if (run) {
    console.log(`Road: ${String(run.road ?? "unknown")}. ${describeRun(run)}`);
  } else {
    console.log("Road: pool. No run in a whole minute, and on the pool road the vault runs every five minutes.");
  }
}

const commands: Record<string, () => Promise<void>> = { here, pool, status, remove };
const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error("Usage: node scripts/egress.ts here | pool | status | remove");
  process.exit(2);
}
await command();

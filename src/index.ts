import { app } from "./app";
import { syncCollection, syncDue } from "./sync";
import { discogsRoad, runValuationBatch } from "./valuation";

/**
 * On the pool road the job acts on every fifth tick only. The shared allowance is nearly always
 * spent by other Workers, so knocking every minute buys little.
 */
export const POOL_EVERY_MINUTES = 5;

export default {
  fetch: app.fetch,

  // One cron, every minute (wrangler.jsonc triggers.crons). Usually it prices a batch of records.
  // Once a day the tick syncs the Discogs collection instead, so the two never share one
  // invocation's request budget.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env, controller.cron, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;

async function runScheduled(env: Env, cron: string, scheduledAt: Date): Promise<void> {
  const road = discogsRoad(env);
  if (road === "pool" && scheduledAt.getUTCMinutes() % POOL_EVERY_MINUTES !== 0) return;
  try {
    if (await syncDue(env, new Date())) {
      await syncCollection(env, { source: "cron" }); // logs its own sync.run line
      return;
    }
    const summary = await runValuationBatch(env);
    console.log(JSON.stringify({ event: "valuation.batch", cron, ...summary }));
  } catch (error) {
    console.error(JSON.stringify({ event: "scheduled.failed", cron, road, error: error instanceof Error ? error.message : String(error) }));
  }
}

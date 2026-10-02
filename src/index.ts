import { app } from "./app";
import { syncCollection, syncDue } from "./sync";
import { runValuationBatch } from "./valuation";

export default {
  fetch: app.fetch,

  // One cron, every minute (wrangler.jsonc triggers.crons). Usually it prices a batch of records.
  // Once a day the tick syncs the Discogs collection instead, so the two never share one
  // invocation's request budget.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env, controller.cron));
  },
} satisfies ExportedHandler<Env>;

async function runScheduled(env: Env, cron: string): Promise<void> {
  try {
    if (await syncDue(env, new Date())) {
      await syncCollection(env, { source: "cron" }); // logs its own sync.run line
      return;
    }
    const summary = await runValuationBatch(env);
    console.log(JSON.stringify({ event: "valuation.batch", cron, ...summary }));
  } catch (error) {
    console.error(JSON.stringify({ event: "scheduled.failed", cron, error: error instanceof Error ? error.message : String(error) }));
  }
}

import { app } from "./app";
import { runValuationBatch } from "./valuation";

export default {
  fetch: app.fetch,

  // The valuation job. Cadence is set in wrangler.jsonc (triggers.crons).
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledValuation(env, controller.cron));
  },
} satisfies ExportedHandler<Env>;

async function runScheduledValuation(env: Env, cron: string): Promise<void> {
  try {
    const summary = await runValuationBatch(env);
    console.log(JSON.stringify({ event: "valuation.batch", cron, ...summary }));
  } catch (error) {
    console.error(JSON.stringify({ event: "valuation.batch_failed", cron, error: error instanceof Error ? error.message : String(error) }));
  }
}

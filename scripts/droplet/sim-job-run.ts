/**
 * Unified droplet runner for canonical TS simulation jobs (no sim math here).
 * Usage:
 *   npx tsx scripts/droplet/sim-job-run.ts gapfill_compare <compareRunId>
 *   npx tsx scripts/droplet/sim-job-run.ts past_sim_recalc <jobId>
 */
import { runGapfillCompareQueuedWorker } from "../../modules/usageSimulator/gapfillCompareQueuedWorker";
import { runPastSimRecalcQueuedWorker } from "../../modules/usageSimulator/pastSimRecalcQueuedWorker";
import {
  SIM_DROPLET_JOB_KIND_GAPFILL_COMPARE,
  SIM_DROPLET_JOB_KIND_PAST_SIM_RECALC,
} from "../../modules/usageSimulator/dropletSimWebhook";

const kind = process.argv[2]?.trim();
const id = process.argv[3]?.trim();

async function main() {
  if (!kind || !id) {
    console.error(
      "Usage: npx tsx scripts/droplet/sim-job-run.ts <gapfill_compare|past_sim_recalc> <id>"
    );
    process.exit(1);
  }
  if (kind === SIM_DROPLET_JOB_KIND_GAPFILL_COMPARE) {
    await runGapfillCompareQueuedWorker(id);
    console.log("[sim-job-run] gapfill_compare ok", id);
    return;
  }
  if (kind === SIM_DROPLET_JOB_KIND_PAST_SIM_RECALC) {
    await runPastSimRecalcQueuedWorker(id);
    console.log("[sim-job-run] past_sim_recalc ok", id);
    return;
  }
  console.error("[sim-job-run] unknown job kind:", kind);
  process.exit(1);
}

main().catch((err) => {
  console.error("[sim-job-run] failed", err);
  process.exit(1);
});

import { Worker } from "bullmq";
import { updateJobStatus } from "./jobs";
import { RunRequestSchema } from "../schemas/request";
import { RunResponseSchema } from "../schemas/response";
import { createAgentState } from "../agent/state";
import { runAgent } from "../agent/reactLoop";
import { PROMPT_VERSION } from "../llm/promptBuilder";

export function startWorker(): void {
  if (!process.env.REDIS_URL) {
    console.log("No REDIS_URL — BullMQ worker not started");
    return;
  }

  const worker = new Worker(
    "roadmap-copilot",
    async (job) => {
      const jobId = job.id ?? "";
      updateJobStatus(jobId, "running");

      const parsed = RunRequestSchema.parse(job.data);
      const state = createAgentState(parsed);
      const t0 = Date.now();
      const loopResult = await runAgent(state);

      const response = RunResponseSchema.parse({
        success: loopResult.finished,
        final_message: loopResult.message,
        roadmap_updated: loopResult.roadmapUpdated,
        slug: loopResult.slug,
        steps: loopResult.steps,
        context_trace: loopResult.traces,
        provider: state.provider,
        model: state.model,
        metadata: {
          latency_ms: Date.now() - t0,
          fallback_used: state.fallbackUsed,
          retry_count: state.retryCount,
          prompt_version: PROMPT_VERSION,
          token_usage: state.tokenUsage,
        },
      });

      updateJobStatus(jobId, "completed", response);
      return response;
    },
    {
      connection: { url: process.env.REDIS_URL },
      concurrency: 5,
    }
  );

  worker.on("failed", (job, err) => {
    if (job) updateJobStatus(job.id ?? "", "failed", undefined, err.message);
  });

  console.log("BullMQ worker started");
}

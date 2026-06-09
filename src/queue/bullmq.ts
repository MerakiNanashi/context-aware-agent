let queue: unknown = null;
let worker: unknown = null;

export async function enqueueJob(
  jobId: string,
  data: unknown
): Promise<void> {
  if (!process.env.REDIS_URL) {
    // No Redis — in-memory fallback; worker.ts polls jobs map
    processInMemory(jobId, data);
    return;
  }

  try {
    const { Queue } = await import("bullmq");
    if (!queue) {
      queue = new Queue("roadmap-copilot", {
        connection: { url: process.env.REDIS_URL },
      });
    }
    await (queue as InstanceType<typeof Queue>).add("run", data, {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });
  } catch (err) {
    console.error("BullMQ enqueue failed, running in-memory:", err);
    processInMemory(jobId, data);
  }
}

function processInMemory(jobId: string, data: unknown): void {
  // Defer to next tick so the HTTP response is sent first
  setImmediate(async () => {
    const { updateJobStatus } = await import("./jobs");
    const { RunRequestSchema } = await import("../schemas/request");
    const { createAgentState } = await import("../agent/state");
    const { runAgent } = await import("../agent/reactLoop");
    const { PROMPT_VERSION } = await import("../llm/promptBuilder");
    const { RunResponseSchema } = await import("../schemas/response");

    updateJobStatus(jobId, "running");

    try {
      const parsed = RunRequestSchema.parse(data);
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
    } catch (err) {
      updateJobStatus(jobId, "failed", undefined, (err as Error).message);
    }
  });
}

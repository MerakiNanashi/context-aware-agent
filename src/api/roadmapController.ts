import { Request, Response } from "express";
import { RunRequestSchema } from "../schemas/request";
import { RunResponseSchema, RunResponse } from "../schemas/response";
import { createAgentState } from "../agent/state";
import { runAgent } from "../agent/reactLoop";
import { PROMPT_VERSION } from "../llm/promptBuilder";
import { ZodError } from "zod";

export async function runRoadmapCopilot(req: Request, res: Response): Promise<void> {
  const t0 = Date.now();

  // 1. Validate input
  let parsed;
  try {
    parsed = RunRequestSchema.parse(req.body);
  } catch (err) {
    res.status(400).json({
      error: "Invalid request",
      details: (err as ZodError).errors,
    });
    return;
  }

  // 2. Initialize state
  const state = createAgentState(parsed);

  // 3. Run agent
  let loopResult;
  try {
    loopResult = await runAgent(state);
  } catch (err) {
    res.status(500).json({
      error: "Agent run failed",
      message: (err as Error).message,
    });
    return;
  }

  // 4. Build response
  const response: RunResponse = {
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
  };

  // 5. Validate output
  try {
    RunResponseSchema.parse(response);
  } catch (err) {
    // Schema validation failure — return the response anyway with a warning
    console.error("Response schema validation failed:", (err as ZodError).errors);
    res.status(500).json({
      error: "Response schema validation failed",
      details: (err as ZodError).errors,
    });
    return;
  }

  res.status(200).json(response);
}

import { z } from "zod";

export const ContextTraceSchema = z.object({
  step: z.number(),
  tokens_used: z.number(),
  token_budget: z.number(),
  context_included: z.array(z.string()),
  context_evicted: z.array(z.string()),
  context_decisions: z.array(z.string()),
});

export const AgentStepSchema = z.object({
  step: z.number(),
  type: z.enum(["tool_call", "tool_result", "guardrail_block", "finish", "error", "llm_response"]),
  tool_name: z.string().optional(),
  tool_args: z.record(z.unknown()).optional(),
  tool_result: z.unknown().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  latency_ms: z.number().optional(),
});

export const MetadataSchema = z.object({
  latency_ms: z.number(),
  fallback_used: z.boolean(),
  retry_count: z.number(),
  prompt_version: z.string(),
  token_usage: z.array(
    z.object({
      step: z.number(),
      input_tokens: z.number(),
      output_tokens: z.number(),
    })
  ),
});

export const RunResponseSchema = z.object({
  success: z.boolean(),
  final_message: z.string(),
  roadmap_updated: z.boolean(),
  slug: z.string(),
  steps: z.array(AgentStepSchema),
  context_trace: z.array(ContextTraceSchema),
  provider: z.string(),
  model: z.string(),
  metadata: MetadataSchema.optional(),
});

export type AgentStep = z.infer<typeof AgentStepSchema>;
export type ContextTrace = z.infer<typeof ContextTraceSchema>;
export type RunResponse = z.infer<typeof RunResponseSchema>;
export type Metadata = z.infer<typeof MetadataSchema>;

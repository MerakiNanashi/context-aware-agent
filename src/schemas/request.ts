import { z } from "zod";

export const SessionMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  estimated_tokens: z.number().optional(),
});

export const RunRequestSchema = z.object({
  user_message: z.string().min(1),
  session_history: z.array(SessionMessageSchema).default([]),
  token_budget_per_model_call: z.number().positive().default(3500),
  max_steps: z.number().positive().max(20).default(8),
  idempotency_key: z.string().optional(),
});

export type SessionMessage = z.infer<typeof SessionMessageSchema>;
export type RunRequest = z.infer<typeof RunRequestSchema>;

import { RunRequest } from "../schemas/request";
import { AgentState } from "./types";

export function createAgentState(req: RunRequest): AgentState {
  const provider = process.env.LLM_PROVIDER ?? "anthropic";
  const model =
    process.env.LLM_MODEL ??
    (provider === "openai" ? "gpt-4o-mini" : "claude-sonnet-4-20250514");

  return {
    userMessage: req.user_message,
    sessionHistory: req.session_history,
    tokenBudget: req.token_budget_per_model_call,
    maxSteps: req.max_steps,
    currentStep: 0,
    profile: undefined,
    roadmap: undefined,
    steps: [],
    contextTrace: [],
    finalMessage: undefined,
    roadmapUpdated: false,
    provider,
    model,
    retryCount: 0,
    fallbackUsed: false,
    startTime: Date.now(),
    tokenUsage: [],
  };
}

import { AgentState } from "../agent/types";
import { SessionMessage } from "../schemas/request";
import { ContextTrace } from "../schemas/response";
import { estimateTokens } from "./tokenEstimator";
import { rankMessages, ScoredMessage } from "./relevanceScorer";

const SYSTEM_PROMPT_TOKENS = 300; // reserved for system prompt
const TOOL_RESULT_RESERVE = 600; // reserve for tool call output + model reply
const ROADMAP_COMPACT_THRESHOLD = 500; // if roadmap JSON > this, compact it

export interface BuiltContext {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  trace: ContextTrace;
}

/**
 * Compact a roadmap to a short summary string instead of full JSON.
 */
function compactRoadmap(roadmap: unknown): string {
  const r = roadmap as {
    slug: string;
    months: Array<{ month: number; title: string; activities: string[] }>;
  };
  const monthSummaries = r.months
    .map((m) => `M${m.month}: ${m.title} [${m.activities.join(", ")}]`)
    .join(" | ");
  return `Roadmap ${r.slug}: ${monthSummaries}`;
}

export function buildContext(state: AgentState, step: number): BuiltContext {
  const budget = state.tokenBudget;
  const available = budget - SYSTEM_PROMPT_TOKENS - TOOL_RESULT_RESERVE;

  const included: string[] = [];
  const evicted: string[] = [];
  const decisions: string[] = [];

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  let usedTokens = SYSTEM_PROMPT_TOKENS;

  // --- Recent in-run tool results (always include last 2 steps) ---
  const recentSteps = state.steps.slice(-2);
  for (const s of recentSteps) {
    if (s.tool_result !== undefined) {
      let resultText: string;
      const rawResult = s.tool_result as Record<string, unknown>;

      // Check if this is a roadmap result and needs compaction
      if (
        s.tool_name === "get_roadmap" &&
        JSON.stringify(s.tool_result).length / 4 > ROADMAP_COMPACT_THRESHOLD
      ) {
        resultText = `[Tool: get_roadmap] ${compactRoadmap(rawResult)}`;
        decisions.push(`compacted get_roadmap result at step ${s.step}`);
      } else {
        resultText = `[Tool: ${s.tool_name}] ${JSON.stringify(s.tool_result)}`;
      }

      const t = estimateTokens(resultText);
      if (usedTokens + t < available) {
        messages.unshift({ role: "assistant" as const, content: resultText });
        usedTokens += t;
        included.push(`tool_result:${s.tool_name}:step${s.step}`);
      } else {
        evicted.push(`tool_result:${s.tool_name}:step${s.step} (over budget)`);
      }
    }
  }

  // --- Session history: rank by relevance, fit greedily ---
  const ranked: ScoredMessage[] = rankMessages(state.sessionHistory, state.userMessage);
  const keptHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const scored of ranked) {
    const t = estimateTokens(scored.message.content);
    if (usedTokens + t < available - 100) {
      keptHistory.push({
        role: scored.message.role,
        content: scored.message.content,
      });
      usedTokens += t;
      included.push(
        `history:${scored.message.role}:score${scored.score.toFixed(2)}:${scored.reason}`
      );
    } else {
      evicted.push(
        `history:${scored.message.role}:${scored.reason} (score ${scored.score.toFixed(2)}, ${t} tokens)`
      );
      decisions.push(
        `evicted low-relevance history (${scored.reason}) to fit budget`
      );
    }
  }

  // Insert history before tool results (chronological order)
  messages.unshift(...keptHistory);

  // --- Current user message always last ---
  const userTokens = estimateTokens(state.userMessage);
  messages.push({ role: "user", content: state.userMessage });
  usedTokens += userTokens;
  included.push("user_message:current");

  const trace: ContextTrace = {
    step,
    tokens_used: usedTokens,
    token_budget: budget,
    context_included: included,
    context_evicted: evicted,
    context_decisions: decisions,
  };

  return { messages, trace };
}

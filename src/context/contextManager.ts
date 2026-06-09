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
  let usedTokens = SYSTEM_PROMPT_TOKENS;

  // Track structured steps chronologically with unified sequence indices
  const processedStepMessages: Array<{ role: "user" | "assistant"; content: string; orderIndex: number }> = [];

  // =========================================================================
  // 1. ANCHOR CRITICAL TOOL MEMORY (STICKY LOOKUPS)
  // =========================================================================
  // Locate the baseline snapshot retrieval, regardless of how deep the loop is
  const baselineRoadmapStep = state.steps.find((s) => s.tool_name === "get_roadmap" && s.type === "tool_result");

  if (baselineRoadmapStep && baselineRoadmapStep.tool_result) {
    let resultText: string;
    const rawResult = baselineRoadmapStep.tool_result as Record<string, unknown>;
    
    // Always compact the baseline roadmap once we advance deep into iterations to protect token space
    const shouldCompactBaseline = step > 2 || (JSON.stringify(rawResult).length / 4 > ROADMAP_COMPACT_THRESHOLD);

    if (shouldCompactBaseline) {
      resultText = `[Sticky Context: get_roadmap (Compacted)] ${compactRoadmap(rawResult)}`;
      decisions.push(`compacted sticky baseline get_roadmap data at step ${baselineRoadmapStep.step}`);
    } else {
      resultText = `[Sticky Context: get_roadmap] ${JSON.stringify(rawResult)}`;
    }

    const t = estimateTokens(resultText);
    if (usedTokens + t < available) {
      processedStepMessages.push({
        role: "user", // Assigning user/system roles keeps it pinned high in attention matrices
        content: resultText,
        orderIndex: baselineRoadmapStep.step
      });
      usedTokens += t;
      included.push(`sticky_tool_result:get_roadmap:step${baselineRoadmapStep.step}`);
    }
  }

  // =========================================================================
  // 2. PROCESS ADJACENT IN-RUN RUNWAY (LAST 2 ACTIONS)
  // =========================================================================
  // Exclude the baseline step from this trail to avoid duplication anomalies
  const trailingSteps = state.steps
    .filter((s) => s !== baselineRoadmapStep && s.tool_result !== undefined)
    .slice(-2);

  for (const s of trailingSteps) {
    const resultText = `[Step ${s.step} Result: ${s.tool_name}] ${JSON.stringify(s.tool_result)}`;
    const t = estimateTokens(resultText);

    if (usedTokens + t < available) {
      processedStepMessages.push({
        role: "assistant",
        content: resultText,
        orderIndex: s.step
      });
      usedTokens += t;
      included.push(`tool_result:${s.tool_name}:step${s.step}`);
    } else {
      evicted.push(`tool_result:${s.tool_name}:step${s.step} (over budget)`);
    }
  }

  // Enforce chronological sorting for all inner-run tool activities
  processedStepMessages.sort((a, b) => a.orderIndex - b.orderIndex);

  // =========================================================================
  // 3. RANK AND FIT CHRONOLOGICAL CONVERSATION HISTORY
  // =========================================================================
  const ranked: ScoredMessage[] = rankMessages(state.sessionHistory, state.userMessage);
  const selectedHistoryItems: Array<ScoredMessage & { originalIndex: number }> = [];

  for (const scored of ranked) {
    const t = estimateTokens(scored.message.content);
    const historyIndex = state.sessionHistory.indexOf(scored.message);

    // Save 100 tokens overhead cushion room
    if (usedTokens + t < available - 100) {
      selectedHistoryItems.push({
        ...scored,
        originalIndex: historyIndex
      });
      usedTokens += t;
      included.push(`history:${scored.message.role}:score${scored.score.toFixed(2)}:${scored.reason}`);
    } else {
      evicted.push(`history:${scored.message.role}:${scored.reason} (score ${scored.score.toFixed(2)}, ${t} tokens)`);
      decisions.push(`evicted lower value history segment to honor budget constraint`);
    }
  }

  // Restore sorted chronological ordering back to selected dialog history entries
  selectedHistoryItems.sort((a, b) => a.originalIndex - b.originalIndex);

  // =========================================================================
  // 4. STITCH COMBINED CONTEXT ARRAY TIMELINE TOGETHER
  // =========================================================================
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Component A: Historically preserved conversational exchanges
  messages.push(...selectedHistoryItems.map(item => ({
    role: item.message.role,
    content: item.message.content
  })));

  // Component B: Chronologically processed execution steps (Sticky baseline + short-term trail)
  messages.push(...processedStepMessages.map(m => ({
    role: m.role,
    content: m.content
  })));

  // Component C: Active live query prompt anchor
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
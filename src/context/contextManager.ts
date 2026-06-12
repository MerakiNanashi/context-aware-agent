import { AgentState } from "../agent/types";
import { SessionMessage } from "../schemas/request";
import { ContextTrace } from "../schemas/response";
import { estimateTokens } from "./tokenEstimator";
import { rankMessages, ScoredMessage } from "./relevanceScorer";
import { stat } from "fs";

const SYSTEM_PROMPT_TOKENS = 300; // reserved for system prompt
const TOOL_RESULT_RESERVE = 600; // reserve for tool call output + model reply
const ROADMAP_COMPACT_THRESHOLD = 500; // if roadmap JSON > this, compact it

const STOPWORDS = new Set(["the","a","an","and","or","to","for","of","in","on","at","is","are","show","me",]);

interface RoadmapMonth {
  month: number;
  title: string;
  activities: string[];
}

interface Roadmap {
  id: string;
  slug: string;
  title: string;
  months: RoadmapMonth[];
}

interface ScoredMonth {
  score: number;
  month: RoadmapMonth;
}

export interface BuiltContext {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  trace: ContextTrace;
}



function extractQueryFeatures(query: string): {
  months: Set<number>;
  keywords: Set<string>;
} {
  const tokens = query.toLowerCase().match(/\w+/g) ?? [];

  const monthMatches = [
    ...query.toLowerCase().matchAll(/month\s+(\d+)/g),
  ];

  const months = new Set<number>(
    monthMatches.map((m) => Number(m[1]))
  );

  const keywords = new Set(
    tokens.filter(
      (t) =>
        !STOPWORDS.has(t) && !/^\d+$/.test(t) && t !== "month"
    )
  );
  return { months, keywords };
}

function scoreMonth(
  month: RoadmapMonth,
  queryMonths: Set<number>,
  queryKeywords: Set<string>
): number {
  let score = 0;

  if (queryMonths.has(month.month)) {score += 100;}

  const title = month.title.toLowerCase();

  const activities = month.activities.map((a) =>
    a.replace(/_/g, " ").toLowerCase()
  );

  const searchable = `${title} ${activities.join(" ")}`;

  for (const kw of queryKeywords) {
    if (title.includes(kw)) {
      score += 20;
    }
    if (searchable.includes(kw)) {
      score += 10;
    }
  }
  return score;
}

export function retrieveRelevantMonths(
  roadmap: Roadmap,
  query: string,
  topK = 3
): ScoredMonth[] {
  const {
    months: queryMonths,
    keywords: queryKeywords,
  } = extractQueryFeatures(query);

  const scored: ScoredMonth[] = [];

  for (const month of roadmap.months) {
    const score = scoreMonth(
      month,
      queryMonths,
      queryKeywords
    );

    if (score > 0) {
      scored.push({ score, month, });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
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
  const baselineRoadmapStep = state.steps.find((s) => s.tool_name === "get_roadmap" && s.type === "tool_result");


  if (baselineRoadmapStep && baselineRoadmapStep.tool_result) {
    let resultText: string;
    const rawResult = baselineRoadmapStep.tool_result as Record<string, unknown>;

    // allowing LLM to use "updated" as an indication of state
    if (state.roadmapUpdated) {
      processedStepMessages.push({
        role: "user",
        content:
          `[Roadmap Update State] updated=true slug=${state.profile?.roadmap_slug}. The roadmap mutation has already succeeded. Call finish unless the user requested additional modifications.`,
        orderIndex: baselineRoadmapStep.step,
    });
    }
    
    // if step > 2 ie. get road map and get user profile done -> compact, or est tokens more than threshold
    const shouldCompactBaseline = step > 2 || (JSON.stringify(rawResult).length / 4 > ROADMAP_COMPACT_THRESHOLD);

    const roadmap = rawResult as unknown as Roadmap;

    const relevantMonths = retrieveRelevantMonths(
      roadmap,
      state.userMessage,
      3
    );
    if (shouldCompactBaseline) {
      if (relevantMonths.length > 0) {
        resultText =
          `[Context: get_roadmap (Relevant)] ` +
          JSON.stringify({
            slug: roadmap.slug,
            months: relevantMonths.map((m) => m.month),
          });
          decisions.push(`compacted relevant baseline get_roadmap data at step ${baselineRoadmapStep.step}`);
      } else {
        resultText =
          (`[Sticky Context: get_roadmap (Compacted)] ` + compactRoadmap(roadmap) );
          decisions.push(`sticky compacted [relevantMonths <= 0] baseline get_roadmap data at step ${baselineRoadmapStep.step}`);
    }
    } else {
      resultText = `[Context: get_roadmap] ${JSON.stringify(rawResult)}`;
    }
  
    const t = estimateTokens(resultText);
    if (usedTokens + t < available) {
      processedStepMessages.push({
        role: "user", // Keeps it pinned cleanly in background attention structures
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
  // Core Bug Fix: Map to role: "user" so the LLM interprets it as tool confirmation feedback
  const trailingSteps = state.steps
    .filter((s) => s !== baselineRoadmapStep && s.tool_result !== undefined)
    .slice(-2);

  for (const s of trailingSteps) {
    const resultText = `[Step ${s.step} Result: ${s.tool_name}] ${JSON.stringify(s.tool_result)}`;
    const t = estimateTokens(resultText);

    if (usedTokens + t < available) {
      processedStepMessages.push({
        role: "user", // CHANGED FROM "assistant" TO "user" TO CORRECT RE-ENTRY BLINDNESS
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

  selectedHistoryItems.sort((a, b) => a.originalIndex - b.originalIndex);

  // =========================================================================
  // 4. STITCH COMBINED CONTEXT ARRAY TIMELINE TOGETHER
  // =========================================================================
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  messages.push(...selectedHistoryItems.map(item => ({
    role: item.message.role,
    content: item.message.content
  })));

  messages.push(...processedStepMessages.map(m => ({
    role: m.role,
    content: m.content
  })));

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
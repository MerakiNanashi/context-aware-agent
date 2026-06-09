import { buildContext } from "../context/contextManager";
import { AgentState } from "../agent/types";
import { SessionMessage } from "../schemas/request";

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    userMessage: "Add MLOps to month 4 of my data science roadmap and save it.",
    sessionHistory: [],
    tokenBudget: 3500,
    maxSteps: 8,
    currentStep: 1,
    profile: undefined,
    roadmap: undefined,
    steps: [],
    contextTrace: [],
    finalMessage: undefined,
    roadmapUpdated: false,
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    retryCount: 0,
    fallbackUsed: false,
    startTime: Date.now(),
    tokenUsage: [],
    ...overrides,
  };
}

describe("contextManager - buildContext", () => {
  it("always includes the current user message", () => {
    const state = makeState();
    const { messages } = buildContext(state, 1);
    const last = messages[messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toContain("MLOps");
  });

  it("evicts low-relevance noise (transfer learning) from history", () => {
    const noisy: SessionMessage[] = [
      { role: "user", content: "What is transfer learning?" },
      {
        role: "assistant",
        content:
          "Transfer learning is a technique where a model developed for one task is reused. Fine-tuning pretrained networks, ImageNet weights, domain adaptation.",
      },
      { role: "user", content: "Show me month 3 topics." },
      { role: "assistant", content: "Month 3 covers regression, classification, and model evaluation." },
    ];
    const state = makeState({ sessionHistory: noisy, tokenBudget: 800 });
    const { trace } = buildContext(state, 1);

    // At least one eviction should be logged
    const evictedNoise = trace.context_evicted.some((e) => e.includes("noise"));
    expect(evictedNoise).toBe(true);
  });

  it("records token usage within budget", () => {
    const state = makeState();
    const { trace } = buildContext(state, 1);
    expect(trace.tokens_used).toBeLessThanOrEqual(trace.token_budget);
  });

it("compacts large roadmap results", () => {
  const bigRoadmap = {
    slug: "priya-ds-2026",
    months: Array.from({ length: 6 }, (_, i) => ({
      month: i + 1,
      title: `Month ${i + 1}`,
      activities: ["act1", "act2", "act3", "act4", "act5"],
    })),
    revision_history: [],
  };
  const state = makeState({
    tokenBudget: 1200,
    steps: [
      {
        step: 1,
        type: "tool_result",
        tool_name: "get_roadmap",
        tool_result: bigRoadmap,
      },
    ],
  });

  // FIX: Change 2 to 1 so it hits the correct compaction code-path branch
  bigRoadmap.months = Array.from({ length: 24 }, (_, i) => ({
      month: i + 1,
      title: `Month Long Title Extended ${i + 1}`,
      activities: ["activity_alpha", "activity_beta", "activity_gamma", "activity_delta", "activity_epsilon"],
    }));

    const { trace } = buildContext(state, 1); 
    
    console.log("ACTUAL DECISIONS:", trace.context_decisions);
    const compacted = trace.context_decisions.some((d) => d.includes("compacted"));
    expect(compacted).toBe(true);
  });
});

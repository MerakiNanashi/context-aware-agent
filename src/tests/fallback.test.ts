import { generateFallbackResponse } from "../fallback/rulesEngine";
import { AgentState, Roadmap } from "../agent/types";

function makeState(userMessage: string, roadmap?: Roadmap): AgentState {
  return {
    userMessage,
    sessionHistory: [],
    tokenBudget: 3500,
    maxSteps: 8,
    currentStep: 3,
    roadmap,
    profile: { user_id: "usr_8842", name: "Priya", goal_track: "data_science", active_roadmap_id: "rdmp_9f2a", roadmap_slug: "priya-ds-2026", graduation_year: 2027 },
    steps: [],
    contextTrace: [],
    roadmapUpdated: false,
    provider: "gemini",
    model: "test",
    retryCount: 2,
    fallbackUsed: true,
    startTime: Date.now(),
    tokenUsage: [],
  };
}

const mockRoadmap: Roadmap = {
  id: "rdmp_9f2a",
  slug: "priya-ds-2026",
  title: "6-month Data Science Path",
  months: [
    { month: 4, title: "Model tuning & ensembles", activities: ["feature_engineering"] },
  ],
  revision_history: [],
};

describe("rulesEngine - generateFallbackResponse", () => {
  it("adds MLOps activities to month 4 when intent matches", () => {
    const state = makeState(
      "Add MLOps to month 4 of my data science roadmap and save it.",
      mockRoadmap
    );
    const result = generateFallbackResponse(state);
    expect(result.finished).toBe(true);
    expect(result.roadmapUpdated).toBe(true);
    expect(result.message).toContain("[Fallback]");
    expect(result.message).toContain("MLOps");
    expect(result.slug).toBe("priya-ds-2026");
  });

  it("returns graceful message when roadmap not loaded", () => {
    const state = makeState("Add MLOps to month 4 and save.");
    const result = generateFallbackResponse(state);
    expect(result.finished).toBe(true);
    // roadmap wasn't loaded so can't update
    expect(result.message).toContain("[Fallback]");
  });

  it("returns generic fallback for non-update intent", () => {
    const state = makeState("What is the capital of France?", mockRoadmap);
    const result = generateFallbackResponse(state);
    expect(result.finished).toBe(true);
  });
});

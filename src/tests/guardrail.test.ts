import { validateWrite } from "../guardrails/confirmBeforeWrite";
import { ToolError } from "../agent/types";
import { updateRoadmapMonth } from "../tools/updateRoadmapMonth";
import { ToolContext, AgentState, Roadmap } from "../agent/types";

function makeMockState(): AgentState {
  return {
    userMessage: "save it",
    sessionHistory: [],
    tokenBudget: 3500,
    maxSteps: 8,
    currentStep: 1,
    roadmap: {
      id: "rdmp_9f2a",
      slug: "priya-ds-2026",
      title: "6-month Data Science Path",
      months: [
        { month: 4, title: "Model tuning", activities: ["feature_engineering"] },
      ],
      revision_history: [],
    } as Roadmap,
    steps: [],
    contextTrace: [],
    roadmapUpdated: false,
    provider: "gemini",
    model: "test",
    retryCount: 0,
    fallbackUsed: false,
    startTime: Date.now(),
    tokenUsage: [],
  };
}

function makeCtx(state: AgentState): ToolContext {
  return { requestId: "test_req", step: 1, state };
}

describe("guardrail - confirmBeforeWrite", () => {
  it("throws ToolError when confirmed=false", () => {
    expect(() =>
      validateWrite({ confirmed: false }, "update_roadmap_month")
    ).toThrow(ToolError);
  });

  it("throws ToolError when confirmed=undefined", () => {
    expect(() =>
      validateWrite({}, "update_roadmap_month")
    ).toThrow(ToolError);
  });

  it("does not throw when confirmed=true", () => {
    expect(() =>
      validateWrite({ confirmed: true }, "update_roadmap_month")
    ).not.toThrow();
  });
});

describe("updateRoadmapMonth tool", () => {
  it("blocks update when confirmed=false", async () => {
    const state = makeMockState();
    const ctx = makeCtx(state);
    await expect(
      updateRoadmapMonth(
        { month: 4, activities_to_add: ["mlops"], confirmed: false },
        ctx
      )
    ).rejects.toThrow(ToolError);
  });

  it("persists update when confirmed=true", async () => {
    const state = makeMockState();
    const ctx = makeCtx(state);
    const result = await updateRoadmapMonth(
      { month: 4, activities_to_add: ["mlops_fundamentals"], confirmed: true },
      ctx
    );
    expect(result.updated).toBe(true);
    expect(state.roadmapUpdated).toBe(true);
    expect(state.roadmap?.months[0].activities).toContain("mlops_fundamentals");
  });

  it("does not add duplicate activities", async () => {
    const state = makeMockState();
    state.roadmap!.months[0].activities = ["feature_engineering", "mlops_fundamentals"];
    const ctx = makeCtx(state);
    await updateRoadmapMonth(
      { month: 4, activities_to_add: ["mlops_fundamentals"], confirmed: true },
      ctx
    );
    const count = state.roadmap!.months[0].activities.filter(
      (a) => a === "mlops_fundamentals"
    ).length;
    expect(count).toBe(1);
  });
});

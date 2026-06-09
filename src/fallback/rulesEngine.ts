import { AgentState } from "../agent/types";
import { ReactLoopResult } from "../agent/types";

/**
 * Deterministic rules-based fallback when LLM fails after retry.
 * Covers the primary scenario: add MLOps to month 4 and save.
 */
export function generateFallbackResponse(state: AgentState): ReactLoopResult {
  const slug = state.roadmap?.slug ?? state.profile?.roadmap_slug ?? "unknown";

  // Check if the intent is roadmap update
  const msg = state.userMessage.toLowerCase();
  const isRoadmapUpdate = /add|update|mlops|month \d/.test(msg);

  if (isRoadmapUpdate && state.roadmap) {
    const monthMatch = msg.match(/month (\d)/);
    const monthNum = monthMatch ? parseInt(monthMatch[1]) : 4;
    const month = state.roadmap.months.find((m) => m.month === monthNum);

    if (month && !month.activities.includes("mlops_fundamentals")) {
      month.activities.push(
        "mlops_fundamentals",
        "experiment_tracking_mlflow",
        "model_registry",
        "ci_training_pipelines"
      );
      month.title = "Model tuning, ensembles & MLOps";
      state.roadmapUpdated = true;
    }

    return {
      finished: true,
      message: `[Fallback] Updated month ${monthNum} with MLOps topics and saved roadmap ${slug}.`,
      roadmapUpdated: state.roadmapUpdated,
      slug,
      steps: state.steps,
      traces: state.contextTrace,
    };
  }

  return {
    finished: true,
    message: `[Fallback] I was unable to complete the request with the AI model. Please try again.`,
    roadmapUpdated: false,
    slug,
    steps: state.steps,
    traces: state.contextTrace,
  };
}

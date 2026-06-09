import { AgentStep, ContextTrace } from "../schemas/response";
import { SessionMessage } from "../schemas/request";

export interface UserProfile {
  user_id: string;
  name: string;
  goal_track: string;
  active_roadmap_id: string;
  roadmap_slug: string;
  graduation_year: number;
}

export interface RoadmapMonth {
  month: number;
  title: string;
  activities: string[];
}

export interface Roadmap {
  id: string;
  slug: string;
  title: string;
  months: RoadmapMonth[];
  revision_history: Array<{ at: string; note: string }>;
}

export interface AgentState {
  userMessage: string;
  sessionHistory: SessionMessage[];

  tokenBudget: number;
  maxSteps: number;
  currentStep: number;

  profile?: UserProfile;
  roadmap?: Roadmap;

  steps: AgentStep[];
  contextTrace: ContextTrace[];

  finalMessage?: string;
  roadmapUpdated: boolean;

  provider: string;
  model: string;

  retryCount: number;
  fallbackUsed: boolean;
  startTime: number;

  tokenUsage: Array<{ step: number; input_tokens: number; output_tokens: number }>;
}

export interface ReactLoopResult {
  finished: boolean;
  message: string;
  roadmapUpdated: boolean;
  slug: string;
  steps: AgentStep[];
  traces: ContextTrace[];
}

export interface ToolContext {
  requestId: string;
  step: number;
  state: AgentState;
}

export class ToolError extends Error {
  public readonly toolName: string;
  public readonly retryable: boolean;

  constructor(message: string, toolName: string, retryable = false) {
    super(message);
    this.name = "ToolError";
    this.toolName = toolName;
    this.retryable = retryable;
  }
}

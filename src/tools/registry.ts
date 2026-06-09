import { ToolContext } from "../agent/types";
import { getUserProfile, getUserProfileDefinition } from "./getUserProfile";
import { getRoadmap, getRoadmapDefinition } from "./getRoadmap";
import { searchKb, searchKbDefinition } from "./searchKb";
import { updateRoadmapMonth, updateRoadmapMonthDefinition } from "./updateRoadmapMonth";
import { finish, finishDefinition } from "./finish";

export type ToolFn = (
  args: Record<string, unknown>,
  ctx: ToolContext
) => Promise<unknown>;

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
}

const toolFns: Record<string, ToolFn> = {
  get_user_profile: getUserProfile,
  get_roadmap: getRoadmap,
  search_kb: searchKb,
  update_roadmap_month: updateRoadmapMonth,
  finish: finish,
};

export const toolDefinitions: ToolDefinition[] = [
  getUserProfileDefinition,
  getRoadmapDefinition,
  searchKbDefinition,
  updateRoadmapMonthDefinition,
  finishDefinition,
];

export function getTool(name: string): ToolFn | undefined {
  return toolFns[name];
}

export function listTools(): string[] {
  return Object.keys(toolFns);
}

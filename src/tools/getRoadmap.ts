import { ToolContext, ToolError, Roadmap } from "../agent/types";
import * as fs from "fs";
import * as path from "path";

const ROADMAP_PATH = path.join(process.cwd(), "roadmap.json");

// In-memory mock store for saves during the session
let roadmapStore: Roadmap | null = null;

export function resetRoadmapStore(): void {
  roadmapStore = null;
}

export async function getRoadmap(
  _args: Record<string, unknown>,
  ctx: ToolContext
): Promise<Roadmap> {
  try {
    // Return in-memory if already saved this session
    if (roadmapStore) {
      ctx.state.roadmap = roadmapStore;
      return roadmapStore;
    }
    const raw = fs.readFileSync(ROADMAP_PATH, "utf-8");
    const roadmap = JSON.parse(raw) as Roadmap;
    ctx.state.roadmap = roadmap;
    return roadmap;
  } catch (err) {
    throw new ToolError(
      `Failed to load roadmap: ${(err as Error).message}`,
      "get_roadmap",
      false
    );
  }
}

export function persistRoadmap(roadmap: Roadmap): void {
  roadmapStore = roadmap;
}

export const getRoadmapDefinition = {
  name: "get_roadmap",
  description: "Load the student's active roadmap. Call before updating.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
};

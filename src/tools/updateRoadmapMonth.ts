import { ToolContext, ToolError } from "../agent/types";
import { persistRoadmap } from "./getRoadmap";

export interface UpdateRoadmapArgs {
  month: number;
  activities_to_add: string[];
  title?: string;
  confirmed: boolean;
}

export async function updateRoadmapMonth(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ updated: boolean; slug: string; month: number }> {
  const { month, activities_to_add, title, confirmed } = args as unknown as UpdateRoadmapArgs;

  // Guardrail: must be confirmed
  if (!confirmed) {
    throw new ToolError(
      "confirmed must be true before writing. Ask the user to confirm saving, then retry with confirmed=true.",
      "update_roadmap_month",
      true
    );
  }

  const roadmap = ctx.state.roadmap;
  if (!roadmap) {
    throw new ToolError(
      "No roadmap loaded in state. Call get_roadmap first.",
      "update_roadmap_month",
      false
    );
  }

  const monthEntry = roadmap.months.find((m) => m.month === month);
  if (!monthEntry) {
    throw new ToolError(
      `Month ${month} not found in roadmap.`,
      "update_roadmap_month",
      false
    );
  }

  // Merge activities (no duplicates)
  const existing = new Set(monthEntry.activities);
  const added: string[] = [];
  for (const act of activities_to_add) {
    if (!existing.has(act)) {
      monthEntry.activities.push(act);
      added.push(act);
    }
  }

  if (title) {
    monthEntry.title = title;
  }

  // Record revision
  roadmap.revision_history.push({
    at: new Date().toISOString().slice(0, 10),
    note: `Added ${added.join(", ")} to month ${month}`,
  });

  // Persist in-memory
  persistRoadmap(roadmap);
  ctx.state.roadmapUpdated = true;

  return { updated: true, slug: roadmap.slug, month };
}

export const updateRoadmapMonthDefinition = {
  name: "update_roadmap_month",
  description:
    "Add activities to a roadmap month. REQUIRES confirmed=true — only set this after the user has explicitly asked to save.",
  input_schema: {
    type: "object",
    properties: {
      month: { type: "number", description: "Month number (1–6)" },
      activities_to_add: {
        type: "array",
        items: { type: "string" },
        description: "Activity ids to add to the month",
      },
      title: {
        type: "string",
        description: "Optional new title for the month",
      },
      confirmed: {
        type: "boolean",
        description: "Must be true. Set only after user explicitly asks to save.",
      },
    },
    required: ["month", "activities_to_add", "confirmed"],
  },
};

import { ToolContext, ToolError } from "../agent/types";
import { persistRoadmap } from "./getRoadmap";
import * as fs from "fs";
import * as path from "path";

export interface UpdateRoadmapArgs {
  month: number;
  activities_to_add: string[];
  title?: string;
  confirmed: boolean;
}

export async function updateRoadmapMonth(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ updated: boolean; slug: string; month: number ; message: string}> {
  const { month, activities_to_add, title, confirmed } = args as unknown as UpdateRoadmapArgs;

  // Guardrail 1: Strict structural parameter type validation
  if (typeof month !== "number" || !Array.isArray(activities_to_add)) {
    throw new ToolError(
      "Invalid parameter types. 'month' must be a number and 'activities_to_add' must be an array of strings.",
      "update_roadmap_month",
      false
    );
  }

  // Guardrail 2: Explicit mutation confirmation check
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
      "No roadmap loaded in state memory. Call get_roadmap first before attempting mutations.",
      "update_roadmap_month",
      false
    );
  }

  const monthEntry = roadmap.months.find((m) => m.month === month);
  if (!monthEntry) {
    throw new ToolError(
      `Month ${month} does not exist in target roadmap configuration.`,
      "update_roadmap_month",
      false
    );
  }

  // Deduplicate and append activities safely
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

  if (added.length > 0 || title) {
    roadmap.revision_history.push({
      at: new Date().toISOString().slice(0, 10),
      note: `Added ${added.join(", ")} to month ${month}`,
    });
  }

  // Persist state modifications in-memory
  persistRoadmap(roadmap);
  ctx.state.roadmapUpdated = true;

  // --- NEW: Save state results into a separate JSON backup target file ---
  try {
    const backupFileName = `saved_roadmap_${roadmap.slug}_m${month}.json`;
    const backupFilePath = path.join(process.cwd(), "examples", backupFileName);
    
    // Ensure parent directory footprint structure matches safely
    const dir = path.dirname(backupFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(backupFilePath, JSON.stringify(roadmap, null, 2), "utf-8");
  } catch (err) {
    // Gracefully handle file system edge errors to prevent loop interruptions
    console.error(`Warning: Could not write secondary backup json log file: ${(err as Error).message}`);
  }

  return { 
    updated: true, 
    slug: roadmap.slug, 
    month, 
    message: `Successfully added activities [${activities_to_add.join(", ")}] to Month ${month}. The change has been saved to storage. You must now call 'finish' with a message including 'saved' and slug '${roadmap.slug}' to conclude.` 
  };
}

export const updateRoadmapMonthDefinition = {
  name: "update_roadmap_month",
  description:
    "Add activities to a specific roadmap month and commit changes. REQUIRES confirmed=true — only call this after user explicitly requests to save.",
  input_schema: {
    type: "object",
    properties: {
      month: { type: "number", description: "Month number (1–6)" },
      activities_to_add: {
        type: "array",
        items: { type: "string" },
        description: "Activity unique identifiers to append to the target month",
      },
      title: {
        type: "string",
        description: "Optional modified title for the roadmap partition",
      },
      confirmed: {
        type: "boolean",
        description: "Must be true. Pass true only when user explicitly issues a save statement.",
      },
    },
    required: ["month", "activities_to_add", "confirmed"],
  },
};
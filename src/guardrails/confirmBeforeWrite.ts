import { ToolError } from "../agent/types";

/**
 * Standalone guardrail: throws ToolError if confirmed is not true.
 * Also used directly in updateRoadmapMonth tool.
 */
export function validateWrite(args: Record<string, unknown>, toolName: string): void {
  if (args.confirmed !== true) {
    throw new ToolError(
      `confirmed must be true for ${toolName}. The user must explicitly ask to save before this can proceed.`,
      toolName,
      true
    );
  }
}

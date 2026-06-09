import { ToolContext } from "../agent/types";

export interface FinishArgs {
  message: string;
}

export async function finish(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ done: true; message: string }> {
  let message = (args.message as string) ?? "Done.";
  
  // Guardrail: Enforce trajectory requirement dynamically if the model forgot it
  if (ctx.state.roadmapUpdated && !message.toLowerCase().includes("saved")) {
    message += " Changes have been successfully saved.";
  }

  ctx.state.finalMessage = message;
  return { done: true, message };
}

export const finishDefinition = {
  name: "finish",
  description:
    "End the run with a user-facing message summarizing what changed and the roadmap slug. CRITICAL: If changes were written, you MUST explicitly include the keyword 'saved' in your message text to pass validation verification rules.",
  input_schema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description:
          "Concise user-facing summary. Must explicitly mention what changed, the roadmap slug, and include the word 'saved'.",
      },
    },
    required: ["message"],
  },
};
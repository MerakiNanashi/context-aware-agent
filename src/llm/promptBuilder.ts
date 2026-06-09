import * as fs from "fs";
import * as path from "path";

const SYSTEM_PATH = path.join(__dirname, "prompts/system.md");
export const PROMPT_VERSION = "v1.0.0";

function loadSystem(): string {
  try {
    return fs.readFileSync(SYSTEM_PATH, "utf-8");
  } catch {
    return `You are a roadmap copilot on an education platform.
- Use tools to read state before writing.
- When updating a roadmap month, you must set confirmed=true only after the user has asked to save.
- Prefer short tool arguments; do not repeat entire large JSON objects.
- When done, call finish with a concise user-facing message including what changed and the roadmap slug.`;
  }
}

export function buildSystemPrompt(): string {
  return loadSystem();
}

export function buildRetryPrompt(originalPrompt: string, parseError: string): string {
  return `${originalPrompt}

STRICT RETRY: Your previous response could not be parsed as a valid tool call. Error: ${parseError}
You MUST respond with ONLY a tool call. Do not include any text outside of tool use.
Pick the most appropriate tool and call it now.`;
}

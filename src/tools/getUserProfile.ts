import { ToolContext, ToolError, UserProfile } from "../agent/types";
import * as fs from "fs";
import * as path from "path";

const PROFILE_PATH = path.join(process.cwd(), "profile.json");

export async function getUserProfile(
  _args: Record<string, unknown>,
  ctx: ToolContext
): Promise<UserProfile> {
  try {
    const raw = fs.readFileSync(PROFILE_PATH, "utf-8");
    const profile = JSON.parse(raw) as UserProfile;
    ctx.state.profile = profile;
    return profile;
  } catch (err) {
    throw new ToolError(
      `Failed to load user profile: ${(err as Error).message}`,
      "get_user_profile",
      false
    );
  }
}

export const getUserProfileDefinition = {
  name: "get_user_profile",
  description: "Load the current student's profile including their active roadmap id and slug.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
};

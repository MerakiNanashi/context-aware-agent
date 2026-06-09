import { SessionMessage } from "../schemas/request";

const NOISE_PATTERNS = [
  /transfer learning/i,
  /on-campus housing/i,
  /fine-tuning pretrained/i,
  /imagenet weights/i,
  /domain adaptation/i,
];

const HIGH_VALUE_PATTERNS = [
  /roadmap/i,
  /month \d/i,
  /mlops/i,
  /data science/i,
  /save/i,
  /add/i,
  /update/i,
];

export interface ScoredMessage {
  message: SessionMessage;
  score: number;
  reason: string;
}

/**
 * Score 0..1. Higher = more relevant, keep first.
 * Noise patterns push score down; actionable/topical patterns push up.
 */
export function scoreMessage(
  msg: SessionMessage,
  userMessage: string
): ScoredMessage {
  let score = 0.5;
  let reason = "neutral";

  const content = msg.content.toLowerCase();
  const userLower = userMessage.toLowerCase();

  // Heavy penalty for off-topic noise
  for (const pat of NOISE_PATTERNS) {
    if (pat.test(content)) {
      score -= 0.4;
      reason = `noise:${pat.source}`;
      break;
    }
  }

  // Boost for on-topic
  for (const pat of HIGH_VALUE_PATTERNS) {
    if (pat.test(content)) {
      score += 0.2;
      reason = `relevant:${pat.source}`;
      break;
    }
  }

  // Boost if content shares keywords with user message
  const userKeywords = userLower.split(/\s+/).filter((w) => w.length > 4);
  for (const kw of userKeywords) {
    if (content.includes(kw)) {
      score += 0.1;
    }
  }

  // Recency bias: assistant turns adjacent to user action are more useful
  if (msg.role === "assistant") {
    score -= 0.05; // slight recency discount
  }

  return { message: msg, score: Math.max(0, Math.min(1, score)), reason };
}

export function rankMessages(
  history: SessionMessage[],
  userMessage: string
): ScoredMessage[] {
  return history
    .map((m) => scoreMessage(m, userMessage))
    .sort((a, b) => b.score - a.score);
}

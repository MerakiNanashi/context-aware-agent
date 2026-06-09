/**
 * Simple token estimator: ~4 chars per token (good enough for budget checks).
 * Avoids heavy tiktoken dependency for speed.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateObjectTokens(obj: unknown): number {
  return estimateTokens(JSON.stringify(obj));
}

export function fitsBudget(text: string, budget: number): boolean {
  return estimateTokens(text) <= budget;
}

import { ChatAnthropic } from "@langchain/anthropic";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

let cachedModel: ChatAnthropic | null = null;

function getAnthropicApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Missing required environment variable: "ANTHROPIC_API_KEY".');
  }
  return apiKey;
}

export function getAnthropicIntelligenceModel(): ChatAnthropic {
  if (cachedModel) {
    return cachedModel;
  }

  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
  cachedModel = new ChatAnthropic({
    model,
    anthropicApiKey: getAnthropicApiKey(),
    temperature: 0
  });

  return cachedModel;
}

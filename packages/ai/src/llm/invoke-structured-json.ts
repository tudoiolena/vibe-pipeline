import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import type { z, ZodTypeAny } from "zod";

function getMessageTextContent(message: BaseMessage): string {
  const c = message.content;
  if (typeof c === "string") {
    return c;
  }
  if (Array.isArray(c)) {
    return c
      .map((block) => {
        if (typeof block === "string") {
          return block;
        }
        if (block && typeof block === "object" && "type" in block && (block as { type: string }).type === "text") {
          const t = (block as { text?: string }).text;
          return typeof t === "string" ? t : "";
        }
        return "";
      })
      .join("");
  }
  return String(c ?? "");
}

/** Extract first `{ ... }` with brace balancing (ignores braces inside strings). */
export function sliceFirstBalancedJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) {
    throw new Error("No JSON object start in model output");
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  throw new Error("Unbalanced braces in model JSON output");
}

/** Prefer full-string parse (native structured output); fall back to balanced `{...}` slice for prose-wrapped JSON. */
function parseAssistantJsonText(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonStr = sliceFirstBalancedJsonObject(trimmed);
    return JSON.parse(jsonStr);
  }
}

const DEFAULT_STRUCTURED_MAX_TOKENS = 16_384;

function resolveStructuredMaxTokens(model: ChatAnthropic, override?: number): number {
  if (override !== undefined && Number.isFinite(override) && override > 0) {
    return override;
  }
  const env = process.env.ANTHROPIC_STRUCTURED_MAX_TOKENS;
  if (env) {
    const n = Number.parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return Math.max(model.maxTokens ?? 0, DEFAULT_STRUCTURED_MAX_TOKENS);
}

/**
 * Structured payloads via Anthropic Messages API `output_config.format` (json_schema), forwarded through
 * LangChain `ChatAnthropic.invocationKwargs`. See https://docs.anthropic.com/en/docs/build-with-claude/structured-outputs
 *
 * Falls back to plain completion + brace-balanced JSON extraction if the API rejects the request (e.g. older models)
 * or if `ANTHROPIC_DISABLE_NATIVE_STRUCTURED_OUTPUT=1`.
 */
export async function invokeAnthropicStructuredJson<Schema extends ZodTypeAny>(
  model: ChatAnthropic,
  userPrompt: string,
  schema: Schema,
  options?: { maxTokens?: number }
): Promise<z.infer<Schema>> {
  const jsonSchema = toJsonSchema(schema);
  const maxTokens = resolveStructuredMaxTokens(model, options?.maxTokens);

  const disableNative =
    process.env.ANTHROPIC_DISABLE_NATIVE_STRUCTURED_OUTPUT === "1" ||
    process.env.ANTHROPIC_DISABLE_NATIVE_STRUCTURED_OUTPUT === "true";

  if (!disableNative) {
    try {
      const structuredModel = new ChatAnthropic({
        model: model.model,
        anthropicApiKey: model.apiKey ?? model.anthropicApiKey,
        temperature: model.temperature ?? 0,
        maxTokens,
        topK: model.topK,
        topP: model.topP,
        streaming: false,
        clientOptions: model.clientOptions,
        invocationKwargs: {
          ...model.invocationKwargs,
          output_config: {
            format: {
              type: "json_schema",
              schema: jsonSchema
            }
          }
        }
      });
      const res = await structuredModel.invoke([new HumanMessage(userPrompt)]);
      const text = getMessageTextContent(res).trim();
      let parsed: unknown;
      try {
        parsed = parseAssistantJsonText(text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Structured output parse failed: ${msg}\n--- snippet ---\n${text.slice(0, 800)}`);
      }
      return schema.parse(parsed) as z.infer<Schema>;
    } catch (err) {
      if (process.env.ANTHROPIC_STRUCTURED_OUTPUT_STRICT === "1") {
        throw err;
      }
    }
  }

  const fallbackModel = new ChatAnthropic({
    model: model.model,
    anthropicApiKey: model.apiKey ?? model.anthropicApiKey,
    temperature: model.temperature ?? 0,
    maxTokens,
    topK: model.topK,
    topP: model.topP,
    streaming: false,
    clientOptions: model.clientOptions,
    invocationKwargs: model.invocationKwargs
  });
  const res = await fallbackModel.invoke([
    new HumanMessage(
      `${userPrompt}\n\nOutput requirements:\n- Return exactly one JSON object.\n- No markdown code fences, no text before or after the JSON.`
    )
  ]);
  const text = getMessageTextContent(res).trim();
  let parsed: unknown;
  try {
    parsed = parseAssistantJsonText(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Structured JSON parse failed: ${msg}\n--- snippet ---\n${text.slice(0, 800)}`);
  }
  return schema.parse(parsed) as z.infer<Schema>;
}

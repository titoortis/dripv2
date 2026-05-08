import { z } from "zod";

import { SEEDANCE_SYSTEM_PROMPT } from "./system-prompt";

const promptResponseSchema = z.object({
  analysis: z.string().min(1).max(500),
  prompt: z.string().min(20).max(4000),
  settings: z.object({
    aspect_ratio: z.enum(["9:16", "16:9", "1:1", "4:3", "3:4"]),
    duration_seconds: z.number().int().min(4).max(15),
    shot_count: z.number().int().min(1).max(8),
    input_mode: z.enum(["text-to-video", "image-to-video", "multi-image"]),
  }),
});

export type SeedancePromptResponse = z.infer<typeof promptResponseSchema>;

export type SeedanceProvider = "openai" | "anthropic" | "missing";

export function selectProvider(): SeedanceProvider {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "missing";
}

export class PromptEngineerError extends Error {
  readonly code: "missing_key" | "upstream" | "invalid_response" | "timeout";

  constructor(
    code: "missing_key" | "upstream" | "invalid_response" | "timeout",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "PromptEngineerError";
  }
}

const REQUEST_TIMEOUT_MS = 25_000;

/**
 * Generate a Seedance 2.0 production-ready prompt from a user idea.
 *
 * Tries OpenAI first (gpt-4o-mini, JSON mode) when OPENAI_API_KEY is set.
 * Falls back to Anthropic (claude-3-5-haiku-latest) when only
 * ANTHROPIC_API_KEY is set. Throws PromptEngineerError("missing_key", ...)
 * when neither key is configured so callers can render a friendly UI.
 */
export async function generateSeedancePrompt(
  idea: string,
): Promise<SeedancePromptResponse> {
  const provider = selectProvider();
  if (provider === "missing") {
    throw new PromptEngineerError(
      "missing_key",
      "No LLM provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.",
    );
  }

  const userMessage = buildUserMessage(idea);

  const raw =
    provider === "openai"
      ? await callOpenAI(userMessage)
      : await callAnthropic(userMessage);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PromptEngineerError(
      "invalid_response",
      `Provider did not return valid JSON. First 200 chars: ${raw.slice(0, 200)}`,
    );
  }

  const result = promptResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new PromptEngineerError(
      "invalid_response",
      `Provider JSON failed schema. ${result.error.message}`,
    );
  }
  return result.data;
}

function buildUserMessage(idea: string): string {
  const trimmed = idea.trim();
  return [
    "User idea (may be in any language; translate any non-English content into English in the final prompt):",
    "---",
    trimmed,
    "---",
    "Respond with the JSON object specified in <output_format>. Nothing else.",
  ].join("\n");
}

async function callOpenAI(userMessage: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new PromptEngineerError("missing_key", "OPENAI_API_KEY missing.");
  }
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        // Strict json_schema mode: forces the model to return exactly this
        // shape, no missing keys, no extras. Supported by gpt-4o, gpt-4o-mini.
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "seedance_prompt",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["analysis", "prompt", "settings"],
              properties: {
                analysis: { type: "string" },
                prompt: { type: "string" },
                settings: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "aspect_ratio",
                    "duration_seconds",
                    "shot_count",
                    "input_mode",
                  ],
                  properties: {
                    aspect_ratio: {
                      type: "string",
                      enum: ["9:16", "16:9", "1:1", "4:3", "3:4"],
                    },
                    duration_seconds: {
                      type: "integer",
                      minimum: 4,
                      maximum: 15,
                    },
                    shot_count: { type: "integer", minimum: 1, maximum: 8 },
                    input_mode: {
                      type: "string",
                      enum: [
                        "text-to-video",
                        "image-to-video",
                        "multi-image",
                      ],
                    },
                  },
                },
              },
            },
          },
        },
        messages: [
          { role: "system", content: SEEDANCE_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new PromptEngineerError(
        "upstream",
        `OpenAI ${res.status}: ${body.slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new PromptEngineerError(
        "invalid_response",
        "OpenAI returned empty content.",
      );
    }
    return content;
  } catch (err) {
    if (err instanceof PromptEngineerError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new PromptEngineerError("timeout", "OpenAI request timed out.");
    }
    throw new PromptEngineerError(
      "upstream",
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(userMessage: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new PromptEngineerError(
      "missing_key",
      "ANTHROPIC_API_KEY missing.",
    );
  }
  const model = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0.7,
        system: SEEDANCE_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `${userMessage}\n\nRespond with ONLY the JSON object. No prose, no markdown fences.`,
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new PromptEngineerError(
        "upstream",
        `Anthropic ${res.status}: ${body.slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((b) => b.type === "text")?.text?.trim();
    if (!text) {
      throw new PromptEngineerError(
        "invalid_response",
        "Anthropic returned no text content.",
      );
    }
    return stripJsonFences(text);
  } catch (err) {
    if (err instanceof PromptEngineerError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new PromptEngineerError(
        "timeout",
        "Anthropic request timed out.",
      );
    }
    throw new PromptEngineerError(
      "upstream",
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(timer);
  }
}

function stripJsonFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text;
}

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  generateSeedancePrompt,
  PromptEngineerError,
  selectProvider,
} from "@/lib/server/seedance/prompt-engineer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  idea: z
    .string()
    .trim()
    .min(3, "Tell us a bit more — at least 3 characters.")
    .max(2000, "Keep it under 2000 characters."),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Body must be JSON." },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: "invalid_request",
        message: first?.message ?? "Invalid request.",
      },
      { status: 400 },
    );
  }

  const provider = selectProvider();
  if (provider === "missing") {
    return NextResponse.json(
      {
        error: "service_unconfigured",
        message:
          "The prompt engineer is not connected yet. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to enable it.",
      },
      { status: 503 },
    );
  }

  try {
    const result = await generateSeedancePrompt(parsed.data.idea);
    return NextResponse.json({
      provider,
      ...result,
    });
  } catch (err) {
    if (err instanceof PromptEngineerError) {
      const status =
        err.code === "missing_key"
          ? 503
          : err.code === "timeout"
            ? 504
            : err.code === "invalid_response"
              ? 502
              : 502;
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status },
      );
    }
    return NextResponse.json(
      {
        error: "unknown",
        message: err instanceof Error ? err.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}

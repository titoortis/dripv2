import { z } from "zod";
import { env } from "../env";

// ---------------------------------------------------------------------------
// BytePlus ModelArk Seedance 2.0 — image-to-video provider client.
//
// Reference:
//   POST {ARK_BASE_URL}/contents/generations/tasks
//   GET  {ARK_BASE_URL}/contents/generations/tasks/{task_id}
//
// Files API (OpenAI-compatible):
//   POST {ARK_BASE_URL}/files        (multipart/form-data)
//   GET  {ARK_BASE_URL}/files/{id}   (status polling)
//
// Auth: Authorization: Bearer ARK_API_KEY
// ---------------------------------------------------------------------------

export type ProviderTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "expired"
  | "cancelled";

const TaskCreateResponseSchema = z.object({
  id: z.string(),
  model: z.string().optional(),
  status: z.string().optional(),
});

const TaskGetResponseSchema = z.object({
  id: z.string(),
  model: z.string().optional(),
  status: z.string(),
  content: z
    .object({
      video_url: z.string().optional(),
      last_frame_url: z.string().optional(),
    })
    .optional(),
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
  usage: z
    .object({
      total_tokens: z.number().optional(),
    })
    .optional(),
  created_at: z.union([z.number(), z.string()]).optional(),
  updated_at: z.union([z.number(), z.string()]).optional(),
});

export type SeedanceTask = z.infer<typeof TaskGetResponseSchema>;

export class SeedanceError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly providerCode?: string,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = "SeedanceError";
  }
}

export type CreateImageToVideoInput = {
  modelId: string;
  promptText: string;
  imageUrl: string;
  ratio: string;
  resolution: string;
  durationSec: number;
  generateAudio: boolean;
  returnLastFrame?: boolean;
  seed?: number;
};

// ---------------------------------------------------------------------------
// Files API types — for provider-backed asset spike (Phase 0).
// ---------------------------------------------------------------------------

export type ProviderFileStatus = "processing" | "active" | "failed" | "deleted";

const FileUploadResponseSchema = z.object({
  id: z.string(),
  object: z.literal("file").optional(),
  purpose: z.string().optional(),
  filename: z.string().optional(),
  bytes: z.number().optional(),
  mime_type: z.string().optional(),
  created_at: z.number().optional(),
  expire_at: z.number().optional(),
  status: z.string().optional(),
});

export type ProviderFile = z.infer<typeof FileUploadResponseSchema>;

const FileGetResponseSchema = z.object({
  id: z.string(),
  object: z.literal("file").optional(),
  purpose: z.string().optional(),
  filename: z.string().optional(),
  bytes: z.number().optional(),
  mime_type: z.string().optional(),
  created_at: z.number().optional(),
  expire_at: z.number().optional(),
  status: z.string(),
});

export type ProviderFileInfo = z.infer<typeof FileGetResponseSchema>;

export type SeedanceClient = {
  createImageToVideoTask(input: CreateImageToVideoInput): Promise<{ providerTaskId: string }>;
  getTask(providerTaskId: string): Promise<SeedanceTask>;
  mapStatus(raw: string): ProviderTaskStatus;
  hasCredentials(): boolean;

  /** Upload a file to BytePlus Files API. Returns the provider file ID. */
  uploadFile(buf: Buffer, filename: string, contentType: string): Promise<ProviderFile>;
  /** Poll file status. Only files with status "active" can be used in generation. */
  getFile(fileId: string): Promise<ProviderFileInfo>;
  /** Map raw file status string to typed enum. */
  mapFileStatus(raw: string): ProviderFileStatus;
};

/**
 * Defensive normalization of `ARK_API_KEY` so a paste-with-prefix or trailing
 * whitespace doesn't silently produce HTTP 401 "API key format is incorrect".
 * BytePlus expects the bare key in `Authorization: Bearer <key>`; if the user
 * pasted `Bearer xxx`, our code would otherwise emit `Bearer Bearer xxx`.
 */
function normalizeApiKey(raw: string): string {
  let k = raw.trim();
  // Strip wrapping quotes if any.
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1).trim();
  }
  // Strip leading "Bearer " (case-insensitive) if the user pasted the full header value.
  if (/^bearer\s+/i.test(k)) {
    k = k.replace(/^bearer\s+/i, "").trim();
  }
  return k;
}

function authHeaders(): Record<string, string> {
  const raw = env().ARK_API_KEY;
  if (!raw) {
    throw new SeedanceError(
      "ARK_API_KEY is not configured. Provider calls are blocked.",
      0,
      "missing_api_key",
    );
  }
  const key = normalizeApiKey(raw);
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function endpoint(path: string): string {
  return `${env().ARK_BASE_URL.replace(/\/$/, "")}${path}`;
}

export const seedance: SeedanceClient = {
  async createImageToVideoTask(input) {
    const body = {
      model: input.modelId,
      content: [
        { type: "text", text: input.promptText },
        {
          type: "image_url",
          image_url: { url: input.imageUrl },
          role: "first_frame",
        },
      ],
      ratio: input.ratio,
      resolution: input.resolution,
      duration: input.durationSec,
      generate_audio: input.generateAudio,
      ...(input.returnLastFrame ? { return_last_frame: true } : {}),
      ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
    };

    const res = await fetch(endpoint("/contents/generations/tasks"), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new SeedanceError(
        `Seedance create-task failed: HTTP ${res.status} ${text.slice(0, 400)}`,
        res.status,
        undefined,
        safeJson(text),
      );
    }

    const parsed = TaskCreateResponseSchema.safeParse(safeJson(text));
    if (!parsed.success) {
      throw new SeedanceError(
        `Seedance create-task returned an unexpected payload: ${parsed.error.message}`,
        res.status,
        undefined,
        safeJson(text),
      );
    }
    return { providerTaskId: parsed.data.id };
  },

  async getTask(providerTaskId) {
    const res = await fetch(endpoint(`/contents/generations/tasks/${encodeURIComponent(providerTaskId)}`), {
      method: "GET",
      headers: authHeaders(),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new SeedanceError(
        `Seedance get-task failed: HTTP ${res.status} ${text.slice(0, 400)}`,
        res.status,
        undefined,
        safeJson(text),
      );
    }
    const parsed = TaskGetResponseSchema.safeParse(safeJson(text));
    if (!parsed.success) {
      throw new SeedanceError(
        `Seedance get-task returned an unexpected payload: ${parsed.error.message}`,
        res.status,
        undefined,
        safeJson(text),
      );
    }
    return parsed.data;
  },

  mapStatus(raw) {
    const s = raw.toLowerCase();
    if (["queued", "pending", "submitted"].includes(s)) return "queued";
    if (["running", "in_progress", "processing"].includes(s)) return "running";
    if (["succeeded", "success", "completed", "done"].includes(s)) return "succeeded";
    if (["failed", "error"].includes(s)) return "failed";
    if (["expired", "timeout"].includes(s)) return "expired";
    if (["cancelled", "canceled"].includes(s)) return "cancelled";
    return "running";
  },

  hasCredentials() {
    return Boolean(env().ARK_API_KEY);
  },

  async uploadFile(buf, filename, contentType) {
    const raw = env().ARK_API_KEY;
    if (!raw) {
      throw new SeedanceError(
        "ARK_API_KEY is not configured. Provider calls are blocked.",
        0,
        "missing_api_key",
      );
    }
    const key = normalizeApiKey(raw);

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)], { type: contentType }), filename);
    form.append("purpose", "user_data");

    const res = await fetch(endpoint("/files"), {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new SeedanceError(
        `Files API upload failed: HTTP ${res.status} ${text.slice(0, 400)}`,
        res.status,
        undefined,
        safeJson(text),
      );
    }

    const parsed = FileUploadResponseSchema.safeParse(safeJson(text));
    if (!parsed.success) {
      throw new SeedanceError(
        `Files API upload returned unexpected payload: ${parsed.error.message}`,
        res.status,
        undefined,
        safeJson(text),
      );
    }
    return parsed.data;
  },

  async getFile(fileId) {
    const res = await fetch(
      endpoint(`/files/${encodeURIComponent(fileId)}`),
      { method: "GET", headers: authHeaders() },
    );
    const text = await res.text();
    if (!res.ok) {
      throw new SeedanceError(
        `Files API get-file failed: HTTP ${res.status} ${text.slice(0, 400)}`,
        res.status,
        undefined,
        safeJson(text),
      );
    }
    const parsed = FileGetResponseSchema.safeParse(safeJson(text));
    if (!parsed.success) {
      throw new SeedanceError(
        `Files API get-file returned unexpected payload: ${parsed.error.message}`,
        res.status,
        undefined,
        safeJson(text),
      );
    }
    return parsed.data;
  },

  mapFileStatus(raw) {
    const s = raw.toLowerCase();
    if (["processing", "pending", "uploaded"].includes(s)) return "processing";
    if (["active", "processed"].includes(s)) return "active";
    if (["failed", "error"].includes(s)) return "failed";
    if (["deleted"].includes(s)) return "deleted";
    return "processing";
  },
};

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

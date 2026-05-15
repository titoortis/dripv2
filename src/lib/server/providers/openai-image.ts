/**
 * OpenAI Images Edit wrapper — used by presets that opt into a
 * pre-transform pipeline before submitting to Seedance.
 *
 * Why a thin wrapper instead of the official `openai` package: keeps the
 * dependency tree narrow (no extra ~3 MB of SDK runtime), the Images
 * Edit endpoint is a single multipart POST, and the response is small
 * enough to decode inline. Mirrors `providers/seedance.ts` shape — one
 * function per provider call, typed errors, no hidden state.
 *
 * Provider docs:
 *   POST {base}/images/edits
 *   Headers: Authorization: Bearer <OPENAI_API_KEY>
 *   Body (multipart/form-data):
 *     model     = "gpt-image-2"   (configurable via OPENAI_IMAGE_MODEL)
 *     image     = <file>          (PNG/JPEG/WebP)
 *     prompt    = <string>        (preset.transformPromptTemplate)
 *     size      = "1024x1536"     (portrait, closest to our 9:16 video AR)
 *     quality   = "high"
 *     n         = 1
 *   Response: { data: [{ b64_json: "..." }] }
 *
 * Output is always returned as a `Buffer` of decoded PNG bytes plus the
 * MIME type the caller should persist with. We don't return URLs here —
 * the caller decides where to put the bytes (R2, local FS, etc.) via
 * the project's `storage()` adapter.
 */

import { env } from "../env";
import { logEvent } from "../logger";

export type OpenAiImageSize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";
export type OpenAiImageQuality = "low" | "medium" | "high" | "auto";

export class OpenAiImageError extends Error {
  readonly httpStatus: number;
  readonly providerCode: string | null;

  constructor(message: string, opts: { httpStatus: number; providerCode?: string | null }) {
    super(message);
    this.name = "OpenAiImageError";
    this.httpStatus = opts.httpStatus;
    this.providerCode = opts.providerCode ?? null;
  }
}

export type EditImageInput = {
  /** Public URL of the source image (we fetch the bytes ourselves —
   *  the OpenAI endpoint takes multipart file upload, not a URL). */
  sourceImageUrl: string;
  sourceMimeType: string;
  prompt: string;
  size?: OpenAiImageSize;
  quality?: OpenAiImageQuality;
};

export type EditImageOutput = {
  pngBuffer: Buffer;
  mime: "image/png";
};

/**
 * One reference image (URL + MIME) passed into the multi-image variant of
 * the OpenAI Images Edit endpoint. The provider expects the multipart
 * field name `image[]` repeated once per source, with each part carrying
 * the file bytes. We always fetch the bytes ourselves so the caller can
 * keep handing us URLs from our own storage.
 */
export type ComposeReferenceInput = {
  sources: Array<{ sourceImageUrl: string; sourceMimeType: string }>;
  prompt: string;
  size?: OpenAiImageSize;
  quality?: OpenAiImageQuality;
};

export const openAiImage = {
  hasCredentials(): boolean {
    const k = env().OPENAI_API_KEY;
    return Boolean(k && k.trim().length > 0);
  },

  async editImage(input: EditImageInput): Promise<EditImageOutput> {
    const apiKey = env().OPENAI_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new OpenAiImageError("OPENAI_API_KEY is not configured.", {
        httpStatus: 0,
        providerCode: "missing_api_key",
      });
    }

    const sourceBytes = await fetchImageBytes(input.sourceImageUrl);

    const filename = pickFilename(input.sourceMimeType);
    const form = new FormData();
    form.set("model", env().OPENAI_IMAGE_MODEL);
    form.set("prompt", input.prompt);
    form.set("size", input.size ?? "1024x1536");
    form.set("quality", input.quality ?? "high");
    form.set("n", "1");
    // Cast to Uint8Array so the lib.dom `BlobPart` overload accepts it
    // without quibbling about Buffer's SharedArrayBuffer-allowed buffer
    // type. Bytes on the wire are identical.
    const imageBlob = new Blob([new Uint8Array(sourceBytes)], {
      type: input.sourceMimeType || "image/jpeg",
    });
    form.set("image", imageBlob, filename);

    const url = `${env().OPENAI_BASE_URL.replace(/\/$/, "")}/images/edits`;
    const t0 = Date.now();
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const elapsedMs = Date.now() - t0;

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const code = extractProviderCode(text);
      logEvent("openai_image_edit_error", {
        http_status: resp.status,
        provider_code: code,
        elapsed_ms: elapsedMs,
      });
      throw new OpenAiImageError(
        `OpenAI Images Edit failed: HTTP ${resp.status} ${truncate(text, 400)}`,
        { httpStatus: resp.status, providerCode: code },
      );
    }

    const json = (await resp.json()) as {
      data?: Array<{ b64_json?: string }>;
    };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) {
      logEvent("openai_image_edit_no_data", {
        http_status: resp.status,
        elapsed_ms: elapsedMs,
      });
      throw new OpenAiImageError("OpenAI Images Edit returned no b64_json.", {
        httpStatus: resp.status,
        providerCode: "no_image_data",
      });
    }

    const pngBuffer = Buffer.from(b64, "base64");
    logEvent("openai_image_edit_success", {
      http_status: resp.status,
      elapsed_ms: elapsedMs,
      bytes: pngBuffer.byteLength,
    });
    return { pngBuffer, mime: "image/png" };
  },

  /**
   * Multi-image variant of `/v1/images/edits`. Used by the PR-B
   * reference-sheet stage: takes N source images (typically primary
   * selfie + outfit reference) and composes a single PNG using the
   * preset's `referenceSheetPromptTemplate`. The provider expects the
   * multipart field name `image[]` repeated once per source — every
   * other field is identical to the single-image `editImage` call,
   * including the response shape (`data[0].b64_json`).
   *
   * Errors and observability follow the same taxonomy as `editImage`:
   *   - missing key             → providerCode `missing_api_key`
   *   - source download fails   → providerCode `source_download_failed`
   *   - empty / no b64_json     → providerCode `no_image_data`
   *   - HTTP 4xx/5xx            → providerCode from response body's
   *                               `error.code`, else null; the caller
   *                               (`runner.ts:errorCodeFor`) maps these
   *                               into the `transform_*` / `transform_http_*`
   *                               codes the wallet refund policy already
   *                               recognises, so no new refundable code
   *                               is introduced.
   */
  async composeReferenceSheet(input: ComposeReferenceInput): Promise<EditImageOutput> {
    const apiKey = env().OPENAI_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new OpenAiImageError("OPENAI_API_KEY is not configured.", {
        httpStatus: 0,
        providerCode: "missing_api_key",
      });
    }
    if (input.sources.length === 0) {
      throw new OpenAiImageError("composeReferenceSheet requires at least one source image.", {
        httpStatus: 0,
        providerCode: "missing_source",
      });
    }

    // Fetch every source's bytes up-front so a download failure aborts
    // before we open the multipart upload. Same behavior as `editImage`'s
    // single-image fetch, just N-fold.
    const fetchedSources = await Promise.all(
      input.sources.map(async (s) => ({
        bytes: await fetchImageBytes(s.sourceImageUrl),
        mime: s.sourceMimeType,
      })),
    );

    const form = new FormData();
    form.set("model", env().OPENAI_IMAGE_MODEL);
    form.set("prompt", input.prompt);
    form.set("size", input.size ?? "1024x1536");
    form.set("quality", input.quality ?? "high");
    form.set("n", "1");
    for (let i = 0; i < fetchedSources.length; i += 1) {
      const { bytes, mime } = fetchedSources[i];
      const blob = new Blob([new Uint8Array(bytes)], {
        type: mime || "image/jpeg",
      });
      // The OpenAI Images Edit endpoint accepts repeated `image[]` parts
      // for the multi-image upload form. FormData.append (vs .set) is
      // required here — `.set` would overwrite each prior entry.
      form.append("image[]", blob, pickFilename(mime));
    }

    const url = `${env().OPENAI_BASE_URL.replace(/\/$/, "")}/images/edits`;
    const t0 = Date.now();
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const elapsedMs = Date.now() - t0;

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const code = extractProviderCode(text);
      logEvent("openai_image_compose_error", {
        http_status: resp.status,
        provider_code: code,
        elapsed_ms: elapsedMs,
        sources: fetchedSources.length,
      });
      throw new OpenAiImageError(
        `OpenAI Images Edit (compose) failed: HTTP ${resp.status} ${truncate(text, 400)}`,
        { httpStatus: resp.status, providerCode: code },
      );
    }

    const json = (await resp.json()) as {
      data?: Array<{ b64_json?: string }>;
    };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) {
      logEvent("openai_image_compose_no_data", {
        http_status: resp.status,
        elapsed_ms: elapsedMs,
        sources: fetchedSources.length,
      });
      throw new OpenAiImageError("OpenAI Images Edit (compose) returned no b64_json.", {
        httpStatus: resp.status,
        providerCode: "no_image_data",
      });
    }

    const pngBuffer = Buffer.from(b64, "base64");
    logEvent("openai_image_compose_success", {
      http_status: resp.status,
      elapsed_ms: elapsedMs,
      bytes: pngBuffer.byteLength,
      sources: fetchedSources.length,
    });
    return { pngBuffer, mime: "image/png" };
  },
};

async function fetchImageBytes(url: string): Promise<Buffer> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new OpenAiImageError(
      `Could not download source image: HTTP ${resp.status}`,
      { httpStatus: resp.status, providerCode: "source_download_failed" },
    );
  }
  const buf = await resp.arrayBuffer();
  return Buffer.from(buf);
}

function pickFilename(mime: string): string {
  if (mime === "image/png") return "source.png";
  if (mime === "image/webp") return "source.webp";
  return "source.jpg";
}

function extractProviderCode(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as { error?: { code?: string; type?: string } };
    return parsed.error?.code ?? parsed.error?.type ?? null;
  } catch {
    return null;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

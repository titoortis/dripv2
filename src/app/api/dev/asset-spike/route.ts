import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { seedance, SeedanceError } from "@/lib/server/providers/seedance";
import { logEvent } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DEV-ONLY: Provider-backed asset spike.
 *
 * Validates the BytePlus Files API path:
 *   1. Upload a local SourceImage to the provider Files API
 *   2. Return the file ID + initial status
 *
 * Query the status via GET with ?fileId=<id>.
 *
 * Guarded: only available when NODE_ENV !== "production".
 */

function devGuard(): NextResponse | null {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "dev_only", message: "This endpoint is not available in production." },
      { status: 404 },
    );
  }
  return null;
}

/**
 * POST /api/dev/asset-spike
 * Body: { sourceImageId: string }
 *
 * Reads the SourceImage from our storage, uploads it to BytePlus Files API,
 * and returns the raw provider response.
 */
export async function POST(req: Request) {
  const guard = devGuard();
  if (guard) return guard;

  if (!seedance.hasCredentials()) {
    return NextResponse.json(
      { error: "missing_api_key", message: "ARK_API_KEY is not configured." },
      { status: 503 },
    );
  }

  const json = await req.json().catch(() => null);
  if (!json || typeof json.sourceImageId !== "string") {
    return NextResponse.json(
      { error: "invalid_body", message: "Expected { sourceImageId: string }" },
      { status: 400 },
    );
  }

  const image = await prisma.sourceImage.findUnique({
    where: { id: json.sourceImageId },
  });
  if (!image) {
    return NextResponse.json(
      { error: "not_found", message: "SourceImage not found." },
      { status: 404 },
    );
  }

  // Fetch the image bytes from our storage (local or S3).
  const imageRes = await fetch(image.publicUrl);
  if (!imageRes.ok) {
    return NextResponse.json(
      {
        error: "storage_fetch_failed",
        message: `Could not fetch image from ${image.publicUrl}: HTTP ${imageRes.status}`,
      },
      { status: 502 },
    );
  }
  const buf = Buffer.from(await imageRes.arrayBuffer());

  // Derive a filename from the storage key.
  const filename = image.storageKey.split("/").pop() ?? "upload.jpg";

  try {
    logEvent("asset_spike_upload_start", {
      source_image_id: image.id,
      storage_key: image.storageKey,
      bytes: buf.length,
      mime_type: image.mimeType,
    });

    const providerFile = await seedance.uploadFile(buf, filename, image.mimeType);

    logEvent("asset_spike_upload_done", {
      source_image_id: image.id,
      provider_file_id: providerFile.id,
      provider_status: providerFile.status ?? "unknown",
    });

    return NextResponse.json({
      ok: true,
      sourceImageId: image.id,
      providerFile,
      nextStep: `GET /api/dev/asset-spike?fileId=${providerFile.id}`,
    });
  } catch (err) {
    if (err instanceof SeedanceError) {
      logEvent("asset_spike_upload_error", {
        source_image_id: image.id,
        http_status: err.httpStatus,
        provider_code: err.providerCode,
        message: err.message,
      });
      return NextResponse.json(
        {
          error: "provider_upload_failed",
          httpStatus: err.httpStatus,
          providerCode: err.providerCode,
          message: err.message,
          raw: err.raw,
        },
        { status: 502 },
      );
    }
    throw err;
  }
}

/**
 * GET /api/dev/asset-spike?fileId=<provider-file-id>
 *
 * Polls the BytePlus Files API for the current status of an uploaded file.
 */
export async function GET(req: Request) {
  const guard = devGuard();
  if (guard) return guard;

  if (!seedance.hasCredentials()) {
    return NextResponse.json(
      { error: "missing_api_key", message: "ARK_API_KEY is not configured." },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const fileId = searchParams.get("fileId");
  if (!fileId) {
    return NextResponse.json(
      { error: "missing_param", message: "fileId query parameter is required." },
      { status: 400 },
    );
  }

  try {
    const fileInfo = await seedance.getFile(fileId);
    const mappedStatus = seedance.mapFileStatus(fileInfo.status);

    return NextResponse.json({
      ok: true,
      fileId: fileInfo.id,
      status: fileInfo.status,
      mappedStatus,
      isUsable: mappedStatus === "active",
      raw: fileInfo,
    });
  } catch (err) {
    if (err instanceof SeedanceError) {
      return NextResponse.json(
        {
          error: "provider_get_failed",
          httpStatus: err.httpStatus,
          message: err.message,
          raw: err.raw,
        },
        { status: 502 },
      );
    }
    throw err;
  }
}

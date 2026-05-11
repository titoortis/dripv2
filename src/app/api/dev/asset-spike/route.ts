import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { seedance } from "@/lib/server/providers/seedance";
import {
  ensureProviderAsset,
  refreshProviderAsset,
  ProviderAssetError,
} from "@/lib/server/providers/asset-lifecycle";
import { logEvent } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DEV-ONLY: Provider-backed asset spike.
 *
 * Validates the BytePlus Files API path *through* the durable
 * `ProviderAsset` lifecycle (PR #28). Every call writes a real
 * `ProviderAsset` row so the upload → status-poll dataset is observable
 * by Prisma Studio / the rest of the system.
 *
 *   POST  /api/dev/asset-spike    body: { sourceImageId: string }
 *   GET   /api/dev/asset-spike?fileId=<provider-file-id>
 *   GET   /api/dev/asset-spike?assetId=<provider-asset-id>
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

  try {
    logEvent("asset_spike_upload_start", {
      source_image_id: json.sourceImageId,
    });
    const asset = await ensureProviderAsset(json.sourceImageId);
    return NextResponse.json({
      ok: true,
      sourceImageId: asset.sourceImageId,
      providerAsset: {
        id: asset.id,
        providerFileId: asset.providerFileId,
        provider: asset.provider,
        status: asset.status,
        bytes: asset.bytes,
        mimeType: asset.mimeType,
        providerExpiresAt: asset.providerExpiresAt,
      },
      nextStep: `GET /api/dev/asset-spike?assetId=${asset.id}`,
    });
  } catch (err) {
    if (err instanceof ProviderAssetError) {
      const status =
        err.code === "source_image_not_found"
          ? 404
          : err.code === "storage_fetch_failed"
            ? 502
            : err.code === "provider_upload_failed"
              ? 502
              : 500;
      return NextResponse.json(
        {
          error: err.code,
          message: err.message,
          httpStatus: err.httpStatus,
          providerCode: err.providerCode,
        },
        { status },
      );
    }
    throw err;
  }
}

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
  const assetId = searchParams.get("assetId");
  const fileId = searchParams.get("fileId");

  if (!assetId && !fileId) {
    return NextResponse.json(
      {
        error: "missing_param",
        message: "Provide either assetId (preferred) or fileId.",
      },
      { status: 400 },
    );
  }

  try {
    // assetId path: refresh through the lifecycle layer (writes the row).
    if (assetId) {
      const refreshed = await refreshProviderAsset(assetId);
      return NextResponse.json({
        ok: true,
        providerAsset: {
          id: refreshed.id,
          sourceImageId: refreshed.sourceImageId,
          providerFileId: refreshed.providerFileId,
          provider: refreshed.provider,
          status: refreshed.status,
          isUsable: refreshed.status === "active",
          providerExpiresAt: refreshed.providerExpiresAt,
        },
      });
    }

    // fileId path: best-effort lookup by providerFileId, then refresh.
    const row = await prisma.providerAsset.findFirst({
      where: { providerFileId: fileId ?? "" },
      orderBy: { updatedAt: "desc" },
    });
    if (!row) {
      return NextResponse.json(
        {
          error: "not_found",
          message:
            "No ProviderAsset row matches this fileId. Upload via POST first, then poll by assetId.",
        },
        { status: 404 },
      );
    }
    const refreshed = await refreshProviderAsset(row.id);
    return NextResponse.json({
      ok: true,
      providerAsset: {
        id: refreshed.id,
        sourceImageId: refreshed.sourceImageId,
        providerFileId: refreshed.providerFileId,
        provider: refreshed.provider,
        status: refreshed.status,
        isUsable: refreshed.status === "active",
        providerExpiresAt: refreshed.providerExpiresAt,
      },
    });
  } catch (err) {
    if (err instanceof ProviderAssetError) {
      return NextResponse.json(
        {
          error: err.code,
          message: err.message,
          httpStatus: err.httpStatus,
          providerCode: err.providerCode,
        },
        { status: 502 },
      );
    }
    throw err;
  }
}

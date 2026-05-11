/**
 * Provider asset lifecycle — PR #28.
 *
 * Durable counterpart of the PR #27 spike. Owns the (SourceImage,
 * provider Files API) mirror: upload-once, poll-to-active, refresh state.
 *
 * Boundaries:
 *   - This module is the *only* writer of `ProviderAsset` rows.
 *   - It does not look at `GenerationJob` or `Preset`. The generation
 *     runner consuming these rows lives in PR #29.
 *   - It does not classify failure for refund purposes. Refund taxonomy
 *     stays in `wallet.ts`.
 *
 * Status vocabulary mirrors `ProviderFileStatus` in `seedance.ts`:
 *   processing | active | failed | deleted
 * We additionally persist `expired` locally when `providerExpiresAt` has
 * elapsed and a refresh confirms the provider no longer serves the file.
 */

import type { ProviderAsset, SourceImage } from "@prisma/client";
import { prisma } from "../prisma";
import { logEvent } from "../logger";
import { seedance, SeedanceError, type ProviderFileStatus } from "./seedance";

const PROVIDER = "byteplus_seedance_2" as const;

export type ProviderAssetStatus = ProviderFileStatus | "expired";

export class ProviderAssetError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "source_image_not_found"
      | "storage_fetch_failed"
      | "provider_upload_failed"
      | "provider_get_failed",
    public readonly httpStatus?: number,
    public readonly providerCode?: string,
  ) {
    super(message);
    this.name = "ProviderAssetError";
  }
}

/**
 * Ensure a usable provider-side mirror exists for `sourceImageId`.
 *
 * Behavior:
 *   - If an `active` row exists and its `providerExpiresAt` (when known)
 *     has not elapsed, return it as-is.
 *   - If a `processing` row exists, return it; callers poll via
 *     `refreshProviderAsset`.
 *   - Otherwise upload the image bytes to the provider, persist a fresh
 *     row, and return it. Failed/expired/deleted rows are kept for audit
 *     and the new upload coexists.
 *
 * Idempotent at the (sourceImage, provider) granularity in the common
 * case. Two concurrent calls for the same source image may both upload —
 * that's fine, both rows persist; the most recent active row is preferred
 * by `getActiveProviderAssetForSource`.
 */
export async function ensureProviderAsset(
  sourceImageId: string,
): Promise<ProviderAsset> {
  const sourceImage = await prisma.sourceImage.findUnique({
    where: { id: sourceImageId },
  });
  if (!sourceImage) {
    throw new ProviderAssetError(
      `SourceImage ${sourceImageId} not found.`,
      "source_image_not_found",
    );
  }

  const existing = await prisma.providerAsset.findFirst({
    where: {
      sourceImageId,
      provider: PROVIDER,
      status: { in: ["processing", "active"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (existing && !isProviderExpired(existing)) {
    return existing;
  }

  return uploadAndPersist(sourceImage);
}

/**
 * Read-only accessor used by callers that just want "is the provider-side
 * copy ready right now?". Returns the most recently updated `active` row
 * whose `providerExpiresAt` (when set) is still in the future. Does NOT
 * trigger an upload or a poll.
 */
export async function getActiveProviderAssetForSource(
  sourceImageId: string,
): Promise<ProviderAsset | null> {
  const row = await prisma.providerAsset.findFirst({
    where: {
      sourceImageId,
      provider: PROVIDER,
      status: "active",
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) return null;
  if (isProviderExpired(row)) return null;
  return row;
}

/**
 * Pull the provider's view of an asset and reconcile our row. Idempotent.
 * Returns the refreshed row.
 *
 * - Mapped status replaces ours.
 * - `providerExpiresAt` is updated if the provider returned `expire_at`.
 * - A previously-active row whose deadline has now passed is marked
 *   `expired` locally so callers can re-upload via `ensureProviderAsset`.
 */
export async function refreshProviderAsset(
  assetId: string,
): Promise<ProviderAsset> {
  const row = await prisma.providerAsset.findUnique({ where: { id: assetId } });
  if (!row) {
    throw new ProviderAssetError(
      `ProviderAsset ${assetId} not found.`,
      "source_image_not_found",
    );
  }

  // Terminal-locally states do not need a provider round-trip.
  if (row.status === "failed" || row.status === "deleted") return row;

  try {
    const remote = await seedance.getFile(row.providerFileId);
    const mapped = seedance.mapFileStatus(remote.status);
    const providerExpiresAt =
      typeof remote.expire_at === "number"
        ? new Date(remote.expire_at * 1000)
        : (row.providerExpiresAt ?? null);

    // If the local deadline has passed but the provider still reports
    // active, we trust the provider. If the provider reports failed/
    // deleted, we surface that. Local-only `expired` is set when the
    // provider returns nothing usable AND our deadline has elapsed.
    const nowExpired =
      providerExpiresAt !== null &&
      providerExpiresAt.getTime() < Date.now() &&
      mapped !== "active";

    const updated = await prisma.providerAsset.update({
      where: { id: row.id },
      data: {
        status: nowExpired ? "expired" : mapped,
        providerExpiresAt,
        bytes: remote.bytes ?? row.bytes,
        mimeType: remote.mime_type ?? row.mimeType,
      },
    });
    logEvent("provider_asset_refreshed", {
      provider_asset_id: updated.id,
      source_image_id: updated.sourceImageId,
      provider: updated.provider,
      provider_file_id: updated.providerFileId,
      raw_status: remote.status,
      from: row.status,
      to: updated.status,
    });
    return updated;
  } catch (err) {
    if (err instanceof SeedanceError) {
      logEvent("provider_asset_failed", {
        provider_asset_id: row.id,
        source_image_id: row.sourceImageId,
        provider: row.provider,
        provider_file_id: row.providerFileId,
        http_status: err.httpStatus,
        provider_code: err.providerCode ?? null,
        stage: "refresh",
      });
      throw new ProviderAssetError(
        `Failed to refresh provider asset: ${err.message}`,
        "provider_get_failed",
        err.httpStatus,
        err.providerCode,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isProviderExpired(row: ProviderAsset): boolean {
  if (row.status === "expired") return true;
  if (!row.providerExpiresAt) return false;
  return row.providerExpiresAt.getTime() < Date.now();
}

async function uploadAndPersist(sourceImage: SourceImage): Promise<ProviderAsset> {
  // Storage-layer fetch. We re-use the same `publicUrl` the rest of the
  // app already exposes; switching to a direct storage `get` would be a
  // worthwhile follow-up but out of scope for #28.
  const res = await fetch(sourceImage.publicUrl);
  if (!res.ok) {
    logEvent("provider_asset_failed", {
      source_image_id: sourceImage.id,
      provider: PROVIDER,
      stage: "storage_fetch",
      http_status: res.status,
    });
    throw new ProviderAssetError(
      `Could not fetch source image from ${sourceImage.publicUrl}: HTTP ${res.status}`,
      "storage_fetch_failed",
      res.status,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const filename = sourceImage.storageKey.split("/").pop() ?? "upload.jpg";

  try {
    const remote = await seedance.uploadFile(buf, filename, sourceImage.mimeType);
    const mapped = remote.status
      ? seedance.mapFileStatus(remote.status)
      : ("processing" as const);
    const providerExpiresAt =
      typeof remote.expire_at === "number" ? new Date(remote.expire_at * 1000) : null;

    const row = await prisma.providerAsset.create({
      data: {
        sourceImageId: sourceImage.id,
        provider: PROVIDER,
        providerFileId: remote.id,
        status: mapped,
        bytes: remote.bytes ?? buf.length,
        mimeType: remote.mime_type ?? sourceImage.mimeType,
        providerExpiresAt,
      },
    });
    logEvent("provider_asset_uploaded", {
      provider_asset_id: row.id,
      source_image_id: row.sourceImageId,
      provider: row.provider,
      provider_file_id: row.providerFileId,
      status: row.status,
      bytes: row.bytes,
    });
    return row;
  } catch (err) {
    if (err instanceof SeedanceError) {
      logEvent("provider_asset_failed", {
        source_image_id: sourceImage.id,
        provider: PROVIDER,
        stage: "upload",
        http_status: err.httpStatus,
        provider_code: err.providerCode ?? null,
      });
      throw new ProviderAssetError(
        `Provider upload failed: ${err.message}`,
        "provider_upload_failed",
        err.httpStatus,
        err.providerCode,
      );
    }
    throw err;
  }
}

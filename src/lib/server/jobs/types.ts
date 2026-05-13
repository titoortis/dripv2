// Generation job lifecycle. Source of truth for transitions.
//
//   queued
//     └─► uploading              (source image saved to our storage)
//           └─► submitted        (provider task created; provider_task_id stored)
//                 └─► processing (provider reports running)
//                       ├─► completed  (mp4 copied to our storage)
//                       └─► failed     (provider failed | timeout | invalid input)
//
// Terminal states: completed | failed | cancelled | expired

export type JobStatus =
  | "queued"
  | "uploading"
  | "submitted"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired",
]);

export function isTerminal(status: string): status is "completed" | "failed" | "cancelled" | "expired" {
  return TERMINAL_STATUSES.has(status as JobStatus);
}

// ---------------------------------------------------------------------------
// Failure taxonomy (observability only).
//
// `FailureKind` is a coarse-grained label derived from `errorCode` at every
// terminal-failure site. Stored on `GenerationJob.failureKind`. It is NOT a
// replacement for the refund policy — refund taxonomy keeps living in
// `wallet.ts` (REFUNDABLE_CODES + `http_5*` fallback) and reads `errorCode`
// directly. `failureKind` is for dashboards, UX copy, and future surfacing
// (e.g. "your photo couldn't be processed" vs "we're having trouble").
//
//   - user      : input-side faults. Bad photo, content-policy reject,
//                 anything coming back as provider 4xx that's about the
//                 user's input. No refund (matches wallet policy).
//   - provider  : provider-side faults. 5xx, succeeded_without_url,
//                 download_failed. Refundable.
//   - operator  : our account/configuration is wrong (SetLimitExceeded,
//                 missing model access). Refundable.
//   - internal  : we never reached the provider in a useful way
//                 (missing_api_key, wall_clock_timeout, our own bugs).
//                 Refundable.
// ---------------------------------------------------------------------------

export type FailureKind = "user" | "provider" | "operator" | "internal";

const USER_FAULT_CODES: ReadonlySet<string> = new Set([
  // Provider 4xx surfaced as a typed code lives in `userFault4xx` below; this
  // set is for the *named* codes that our runner / provider can return
  // verbatim. Keep in sync with provider error codes seen in PR 4 / PR 5
  // live validation.
  "InvalidImage",
  "ContentPolicyViolation",
  "FaceNotDetected",
  "MultipleFacesDetected",
]);

const OPERATOR_FAULT_CODES: ReadonlySet<string> = new Set([
  "SetLimitExceeded",
  "ModelNotEntitled",
]);

const PROVIDER_FAULT_CODES: ReadonlySet<string> = new Set([
  "succeeded_without_url",
  "download_failed",
  // pre-transform (PR: f1_pilot_v1) — OpenAI failed to return image bytes
  "transform_no_image_data",
]);

const INTERNAL_FAULT_CODES: ReadonlySet<string> = new Set([
  "missing_api_key",
  "wall_clock_timeout",
  "internal_error",
  // pre-transform (PR: f1_pilot_v1) — our worker could not fetch the
  // user's source image from R2 before sending it to OpenAI
  "transform_source_download_failed",
]);

/**
 * Map a terminal `errorCode` to a `FailureKind`. Returns `null` for the
 * empty/unset case (non-terminal job) so callers can pass through without
 * inventing a value.
 *
 * Resolution order:
 *  1. Named code in one of the explicit sets above (deterministic).
 *  2. `http_5xx` prefix → provider.
 *  3. `http_4xx` prefix → user.
 *  4. Everything else → internal (deliberately conservative — unknown
 *     codes are surfaced as our problem, not the user's).
 */
export function classifyFailure(errorCode: string | null | undefined): FailureKind | null {
  if (!errorCode) return null;
  if (USER_FAULT_CODES.has(errorCode)) return "user";
  if (PROVIDER_FAULT_CODES.has(errorCode)) return "provider";
  if (OPERATOR_FAULT_CODES.has(errorCode)) return "operator";
  if (INTERNAL_FAULT_CODES.has(errorCode)) return "internal";
  if (/^http_5\d{2}$/.test(errorCode)) return "provider";
  if (/^http_4\d{2}$/.test(errorCode)) return "user";
  // Pre-transform (PR: f1_pilot_v1) same taxonomy as Seedance:
  if (/^transform_http_5\d{2}$/.test(errorCode)) return "provider";
  if (/^transform_http_4\d{2}$/.test(errorCode)) return "user";
  return "internal";
}

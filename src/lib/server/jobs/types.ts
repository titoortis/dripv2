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

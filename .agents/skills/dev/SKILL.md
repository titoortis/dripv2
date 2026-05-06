---
name: dev
description: How to develop, lint, build, test, and reset state for the dripv2 mobile-first Seedance 2.0 video MVP. Covers the in-process poller, idempotency model, ARK key behavior, and one common gotcha when resetting the DB.
---

# dripv2 — dev & testing

Mobile-first Next.js 14 (App Router, TS) + Prisma (SQLite dev) + Tailwind app that wraps BytePlus ModelArk Seedance 2.0 image-to-video as a preset-based product. Single deployment unit; in-process poller drives the async job state machine.

## Stack
- Package manager: **pnpm** (via corepack)
- DB (dev): SQLite at `prisma/dev.db`, schema in `prisma/schema.prisma`
- DB (prod): swap `DATABASE_URL` to Postgres; same schema works
- Storage: local by default (`STORAGE_DRIVER=local`, writes to `public/uploads`); S3-compatible adapter ready (`STORAGE_DRIVER=s3`) but not the MVP path
- Provider: `src/lib/server/providers/seedance.ts` (real BytePlus ModelArk shapes, Zod-validated)

## First-time setup
```
corepack enable && corepack prepare pnpm@latest --activate
pnpm install --no-frozen-lockfile
test -f .env || cp .env.example .env
pnpm prisma generate
pnpm db:push      # creates tables
pnpm db:seed      # upserts 12 presets from src/lib/server/presets-source.ts
```

## Day-to-day
```
pnpm dev          # http://localhost:3000
pnpm lint         # next lint
pnpm typecheck    # tsc --noEmit
pnpm build        # next build (production check)
```

All three (`lint`, `typecheck`, `build`) must pass before opening a PR.

## Reset DB + uploaded assets (clean slate)
**Stop the dev server first**, then:
```
rm -f prisma/dev.db
rm -rf public/uploads/images
pnpm db:push && pnpm db:seed
pnpm dev
```

### Gotcha — don't reset the DB while `pnpm dev` is running
Deleting `prisma/dev.db` while Next.js is running keeps Prisma's open SQLite file handle pointed at the deleted inode. The next API call (e.g. `POST /api/uploads`) will succeed at the storage layer but 500 at the Prisma layer because the connection is invalid. Symptom: file appears in `public/uploads/images/...` but the response is HTTP 500. Fix: kill the dev server, reset DB, restart dev server.

## Editing presets
Source of truth: `src/lib/server/presets-source.ts` (TypeScript array of preset entries: id, title, subtitle, promptTemplate, aspectRatio, durationSec, resolution, motionNotes, sortOrder, isActive). Edit in place, run:
```
pnpm db:seed
```
The seed upserts by id and soft-deactivates entries no longer in the source file. UI does not need to be touched — `/api/presets` just returns active rows ordered by `sortOrder`.

## Job state machine
`src/lib/server/jobs/runner.ts` + `src/lib/server/jobs/poller.ts`. States stored as strings on `GenerationJob.status`:
```
queued → uploading → submitted → processing → completed | failed | cancelled | expired
```
Idempotency: SHA256 hash of `{presetId, sourceImageId, model, ratio, resolution, duration, generateAudio, promptTemplate}` keyed on `(sessionId, requestHash)` (unique). Same inputs → same job row.

Poller cadence: tick every 2s (`TICK_MS`), per-job backoff between `POLL_MIN_INTERVAL_MS` (5s) and `POLL_MAX_INTERVAL_MS` (20s), wall-clock cap `JOB_WALL_CLOCK_TIMEOUT_MS` (600s default). Timed-out jobs are marked `expired`. To disable the poller (e.g. for unit tests), set `DISABLE_POLLER=1`.

## Behavior without ARK_API_KEY
Intentional: `submitJob` checks `seedance.hasCredentials()`. With no key, the job goes terminal:
```
status = failed
errorCode = missing_api_key
errorReason = "ARK_API_KEY is not configured. Set it in the environment to enable real generation."
```
Useful as a smoke test of the entire pipeline without provider cost. To run the live path, set `ARK_API_KEY` in `.env` (BytePlus Console → ModelArk → API Keys at https://console.byteplus.com/ark) and the same UI flow proceeds through `submitted → processing → completed`.

## Live generation prerequisites
Beyond `ARK_API_KEY`, Seedance must be able to **fetch** the source image, so the upload's `publicUrl` needs to be reachable from BytePlus's servers. Two paths:
1. Set `STORAGE_DRIVER=s3` + S3-compatible bucket (R2 / S3 / MinIO); uploads go to a public URL.
2. Or set `APP_PUBLIC_BASE_URL` to a tunnel pointing at `localhost:3000` (e.g. ngrok) — files in `public/uploads` are served directly.

Result videos are downloaded from the Seedance signed URL (24h expiry) and copied to our own storage in `persistResult` so URLs in our DB don't go stale.

## Mobile testing locally
The UI is mobile-first and looks correct in Chrome at ≤430px width. Quick way to size the browser without devtools: `wmctrl -r "Google Chrome for Testing" -e 0,40,40,430,900`. Restore with `wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`.

## CSS gotcha — aspect ratio + flex grids
When putting `aspect-[X/Y]` cards inside a CSS Grid that has `flex-1` on it (so the grid fills remaining vertical space), Chrome stretches grid rows to fill the parent and **silently overrides** the per-cell aspect ratio. Cards then render with the wrong shape. Fix: split the scrolling container from the grid:
```tsx
<div className="flex-1 overflow-y-auto">
  <div className="grid grid-cols-2 gap-3">{cards}</div>
</div>
```
Do NOT put `flex-1` directly on the grid that contains aspect-ratio cells.

## Useful endpoints
- `GET  /api/presets` → active presets ordered by sortOrder
- `POST /api/uploads` → multipart `file=`; returns `{sourceImage: {id, publicUrl, mimeType, bytes}}`
- `POST /api/jobs` → JSON `{presetId, sourceImageId}`; returns `{job: {...}}`. Idempotent on `(session cookie, requestHash)`.
- `GET  /api/jobs` → list jobs for the current session cookie
- `GET  /api/jobs/:id` → full job + preset + sourceImage + resultVideo

## Plan + reports
The `_plans/` directory contains `PLAN.md` (architecture & MVP scope), `TEST_PLAN.md` (e2e plan), `test-report.md` (latest run results). These are workspace artifacts and should NOT be added to git; they are useful as context if you take over the project mid-flight.

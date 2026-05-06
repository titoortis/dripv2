# drip — Mobile-first AI video generator (Seedance 2.0)

A clean-slate, production-oriented MVP for a phone-first AI video creator powered by **BytePlus ModelArk Seedance 2.0**. Users upload one photo, pick a preset, and get a stylized short video. No prompts, no auth, no admin.

> Designed to feel natural inside a Telegram Mini App while also working as a normal mobile web app.

---

## What this repo is

- **Single Next.js 14 (App Router, TypeScript) deployable.** Frontend + API routes + in-process job poller in one process.
- **Real Seedance 2.0 image-to-video integration** against the official BytePlus endpoint. No fakes, no shims.
- **Preset configuration layer** — `src/lib/server/presets-source.ts` is the source of truth. Edit and run `pnpm db:seed` to update; UI changes nothing.
- **Mobile-first dark UI** — `375px`+, 44×44 tap targets, safe-area aware, sticky bottom CTA, Higgsfield-style preset grid.
- **Real async lifecycle** — `queued → uploading → submitted → processing → completed | failed | cancelled | expired`, with idempotency, backoff, and result asset copy.
- **No auth.** Each device gets an anonymous session id (cookie). History is scoped to that session.

## Architecture

```
Browser / Telegram Mini App
        │
        ▼
Next.js (App Router, TS)
 ├── UI: landing, create, generating, result, history
 ├── REST: /api/uploads /api/presets /api/jobs /api/jobs/[id] /api/internal/poll
 ├── In-process poller (instrumentation.ts → src/lib/server/jobs/poller.ts)
 └── Prisma → SQLite (dev) / Postgres (prod)
        │
        ▼
   Storage adapter (local | S3-compatible)
        │
        ▼
   BytePlus ModelArk Seedance 2.0
   POST /api/v3/contents/generations/tasks
   GET  /api/v3/contents/generations/tasks/:task_id
```

### Tech stack

- Next.js 14 (App Router, TS)
- Tailwind CSS
- Prisma ORM (SQLite locally, Postgres-friendly schema)
- Zod for boundary validation
- AWS SDK v3 (`@aws-sdk/client-s3`) — works with R2, S3, Backblaze, MinIO
- `@telegram-apps/sdk-react` for Mini App context bridging

## Quickstart (local)

```bash
pnpm install
cp .env.example .env
pnpm prisma generate
pnpm db:push       # creates the SQLite database
pnpm db:seed       # syncs presets from src/lib/server/presets-source.ts
pnpm dev           # http://localhost:3000
```

By default this runs against:
- SQLite at `./prisma/dev.db`
- local file storage at `./public/uploads`, served at `/uploads/...`
- in-process job poller (every 2s), bounded backoff per job

You can use the app **without** an `ARK_API_KEY`. Without it, jobs are created and immediately marked `failed` with `errorCode=missing_api_key` — every other layer (upload, preset selection, job lifecycle, history) still works end-to-end.

## Environment variables

See [`.env.example`](./.env.example) for the full list.

| Variable | Required | Purpose |
|---|---|---|
| `ARK_API_KEY` | for live generation | BytePlus ModelArk API key |
| `ARK_BASE_URL` | no (defaulted) | `https://ark.ap-southeast.bytepluses.com/api/v3` |
| `ARK_DEFAULT_MODEL_ID` | no (defaulted) | `dreamina-seedance-2-0-260128` |
| `DATABASE_URL` | yes | Prisma DB URL (`file:./prisma/dev.db` or `postgres://…`) |
| `STORAGE_DRIVER` | yes | `local` or `s3` |
| `STORAGE_LOCAL_DIR`, `STORAGE_PUBLIC_BASE_URL` | for `local` | Where to write uploads and how they're served |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_BASE_URL` | for `s3` | S3-compatible config |
| `APP_PUBLIC_BASE_URL` | yes for live | Must be reachable from BytePlus so it can fetch the source image |
| `POLL_MIN_INTERVAL_MS`, `POLL_MAX_INTERVAL_MS` | no (defaulted) | Per-job poll backoff window |
| `JOB_WALL_CLOCK_TIMEOUT_MS` | no (defaulted) | Max time a job can sit in non-terminal state |
| `DISABLE_POLLER` | no | Set `true` on serverless deploys; use `/api/internal/poll` cron instead |

## Provider integration

All BytePlus traffic goes through one module: [`src/lib/server/providers/seedance.ts`](src/lib/server/providers/seedance.ts).

- `createImageToVideoTask` → `POST /contents/generations/tasks`
  - Body: `{ model, content: [text, image_url@first_frame], ratio, resolution, duration, generate_audio, ... }`
  - Returns `providerTaskId`.
- `getTask(providerTaskId)` → `GET /contents/generations/tasks/:id`
  - Maps provider statuses to a strict app finite state machine (`queued | running | succeeded | failed | expired | cancelled`).
- On `succeeded`, the runner downloads `content.video_url` and **copies it to our object storage** before reporting `completed`. Provider URLs expire after 24h; we never depend on them.

The choice of regional route (`dreamina-*` BytePlus / `doubao-*` Volcengine) is per-preset via `Preset.modelId`, so you can flip routes without code changes.

## Preset configuration

Source of truth: [`src/lib/server/presets-source.ts`](src/lib/server/presets-source.ts). Each entry has:

- `id`, `title`, `subtitle`
- `promptTemplate` (server-side; never shown in UI)
- `aspectRatio`, `durationSec`, `resolution`, `generateAudio`
- `modelId` (defaults to `dreamina-seedance-2-0-260128`)
- `isActive`, `sortOrder`

Workflow:

```bash
# edit src/lib/server/presets-source.ts
pnpm db:seed
```

The seed script upserts every entry by id and **soft-deactivates** any preset rows whose ids no longer appear in the file (we never hard-delete because past jobs still reference them).

## Async generation lifecycle

```
queued
  └─► uploading                 // image saved to our storage
        └─► submitted           // POST /tasks succeeded; provider_task_id stored
              └─► processing    // first poll showed running
                    ├─► completed  (mp4 copied to our storage → result_video row)
                    ├─► failed     (provider failed | invalid input | timeout)
                    ├─► cancelled
                    └─► expired
```

Idempotency: a job is keyed by `(sessionId, requestHash)` where the hash is a sha256 of the normalized `{preset, source_image, model_id, ratio, resolution, duration, generate_audio, prompt_template}`. The same inputs from the same device will return the existing job instead of creating a duplicate paid generation.

The in-process poller (`src/lib/server/jobs/poller.ts`) ticks every 2s and:
1. submits any `queued` jobs to the provider,
2. polls due `submitted`/`processing` jobs (with linear backoff between `POLL_MIN_INTERVAL_MS` and `POLL_MAX_INTERVAL_MS`),
3. respects `JOB_WALL_CLOCK_TIMEOUT_MS` for hung jobs.

If you deploy somewhere without long-lived processes, set `DISABLE_POLLER=true` and call `POST /api/internal/poll` from a cron (every ~10s).

## Telegram Mini App compatibility

- `src/components/TelegramBoot.tsx` calls `WebApp.ready()`, `expand()`, `disableVerticalSwipes()`, and bridges `themeParams` into CSS vars.
- All layout uses `env(safe-area-inset-*)` via the `.pt-safe`, `.pb-safe`, `.px-safe` utilities.
- All interactions are tap-only — no hover-only logic.
- Outside Telegram (regular browser), the bridge is a noop and the app behaves like a normal mobile web app.

## Status: working / partially validated / blocked

| Layer | Status |
|---|---|
| Mobile-first UI flow (landing, create, generating, result, history, error states) | **working** locally |
| Preset config layer (DB + TS source of truth, seed script) | **working** |
| Image upload → local storage adapter | **working** locally |
| S3-compatible storage adapter | **implemented**; only validated when you supply `S3_*` envs |
| Seedance HTTP client + Zod-validated shapes | **implemented** against published API spec; not live-validated yet |
| Job state machine + in-process poller + idempotency + result copy | **working** in-process |
| Real generation against Seedance | **blocked on `ARK_API_KEY` and a publicly-reachable `APP_PUBLIC_BASE_URL`** |
| Telegram Mini App-specific behavior (theme/safe-areas/expand) | **implemented**; full validation requires opening from a Telegram bot |

## Deployment notes

- Single Node service. Any host that runs `pnpm build && pnpm start` works (Fly, Railway, Render, a VPS).
- For the provider to reach the source image, `APP_PUBLIC_BASE_URL` (if `STORAGE_DRIVER=local`) or `S3_PUBLIC_BASE_URL` (if `STORAGE_DRIVER=s3`) must be reachable from the public internet.
- For Postgres, change `provider = "postgresql"` in `prisma/schema.prisma` and set `DATABASE_URL` accordingly. The schema is portable.
- For serverless, set `DISABLE_POLLER=true` and run a cron that hits `POST /api/internal/poll`.

## Project layout

```
src/
  app/
    page.tsx              # landing
    create/page.tsx       # upload + preset selection
    jobs/[id]/page.tsx    # generating + result + failed
    history/page.tsx      # my videos
    api/
      uploads/route.ts
      presets/route.ts
      jobs/route.ts
      jobs/[id]/route.ts
      internal/poll/route.ts
  components/             # AppShell, Button, Chip, PresetCard, PresetSheet, UploadPad, StatusLine, TelegramBoot
  lib/
    server/
      env.ts              # zod-validated env
      prisma.ts           # singleton client
      session.ts          # anonymous device session
      storage/            # local + s3 adapters
      providers/seedance.ts
      jobs/               # state machine + poller + request hash
      presets-source.ts   # preset source of truth
prisma/
  schema.prisma
  seed.ts
instrumentation.ts        # boots the in-process poller
```

## Non-goals

- Auth / signup
- Marketing landing
- Admin dashboard
- Social feed
- Payment / credits

These are deliberately out of scope for this MVP.

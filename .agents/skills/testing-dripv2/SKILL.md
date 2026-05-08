---
name: testing-dripv2
description: End-to-end test the dripv2 upload → preset → generate → /jobs/[id] flow locally without any provider credentials. Use when verifying landing/CTA changes, friendly failure UI, FSM transitions, structured logs, or rate limits. Skip when the change is provider-shape only (no UI, no FSM, no rate-limit) — a unit/typecheck pass is enough there.
---

# Testing dripv2

## What this skill is for

dripv2 is a Next.js 14 app that submits image-to-video jobs to BytePlus Seedance 2.0. The provider integration is deliberately easy to **disable** by leaving `ARK_API_KEY` empty, which short-circuits the FSM to a terminal `failed:missing_api_key` state in ~2s. That makes the entire upload → preset → generate → result flow testable end-to-end on a laptop with **no provider credentials**.

Use this skill for changes that touch:

- Landing page (`src/app/page.tsx`) — anything that changes the CTA, hero, or removes the public prompt input.
- Create flow (`src/app/create/page.tsx`, `src/components/UploadPad.tsx`, `src/components/PresetCard.tsx`, `src/components/PresetSheet.tsx`).
- Result/failure UI (`src/app/jobs/[id]/page.tsx` and `friendlyFailure()`).
- FSM runner (`src/lib/server/jobs/runner.ts`, `src/lib/server/jobs/poller.ts`).
- Structured logs (`src/lib/server/logger.ts`).
- Rate limits (`src/lib/server/rate-limit.ts`, `src/app/api/uploads/route.ts`, `src/app/api/jobs/route.ts`).
- Idempotency (`src/lib/server/jobs/hash.ts` + `@@unique([sessionId, requestHash])`).

Skip recording when the change is provider-shape only (e.g. tweaking `src/lib/server/providers/seedance.ts` body shape) — `pnpm typecheck && pnpm lint` is enough there, and a real Seedance call needs `ARK_API_KEY` (PR 3+).

## Devin Secrets Needed

- **None** for the no-ARK_API_KEY happy path tested below. Local stack is self-contained: SQLite, local-filesystem storage, in-process poller.
- `ARK_API_KEY` (BytePlus ModelArk) — only needed for live provider testing (PR 3+). Request as a session secret if/when that PR lands.

## Bring up the stack

```
# Repo root: /home/ubuntu/repos/dripv2
test -f .env || cp .env.example .env
# Sanity check: ARK_API_KEY MUST be empty for this skill's tests
grep '^ARK_API_KEY=' .env  # should print 'ARK_API_KEY=' with nothing after

pnpm install --frozen-lockfile          # idempotent
pnpm prisma generate                    # idempotent
pnpm db:push                            # SQLite at file:./dev.db
pnpm db:seed                            # 12 platform presets, idempotent

# Start dev in a background shell, pipe stdout to a known path so you can grep structured logs.
rm -f /tmp/dripv2-dev.log
pnpm dev 2>&1 | tee /tmp/dripv2-dev.log  # waits for 'Ready in <ms>'
```

The app is at `http://localhost:3000`.

## Expected FSM behavior with no ARK_API_KEY

- `POST /api/jobs` immediately creates a row with `status=queued`.
- `submitJob` runs in-process within ~1–2s and **short-circuits before flipping to `uploading`** when `seedance.hasCredentials()` is false. The job ends at `status=failed`, `errorCode=missing_api_key`.
- The runner emits exactly one structured log line:
  ```json
  {"event":"job_failed","job_id":"...","preset_id":"...","from":"queued","reason":"missing_api_key"}
  ```
- `/jobs/[id]` (client component) polls `/api/jobs/[id]` and flips to the failed view with friendly copy (NOT the raw `errorReason` from the DB).

If you see a `queued → uploading` transition followed by a `submitted` line, that means the runner thinks credentials ARE configured. Recheck `.env`.

## Test catalogue

### UI tests (record these — `recording_start` before, `recording_stop` after)

1. **Landing renders preset-first CTA, no public prompt input.**
   - `curl -sS http://localhost:3000/` and assert: `'Pick a preset' in html`, `'/create'` href present, `0` `<textarea>` elements, **no** Russian `Сделать промпт`.
   - Click the `Pick a preset` button → URL becomes `/create`.
2. **Friendly failure UI on `/jobs/[id]`.**
   - From `/create`, click upload pad → select a small PNG. Auto-selects the first preset. Tap `Generate`.
   - Wait ~3s. Take screenshot. Page must show `NOT READY YET` eyebrow, `Generation is not available on this build.` headline, `code: missing_api_key` footer, and **must not** contain the substring `ARK_API_KEY`.
   - Note: `/jobs/[id]` is a `"use client"` component, so `curl` returns only the loading scaffold. **Use a browser screenshot for the friendly-copy assertion**, not curl.

### Shell tests (no recording — capture stdout instead)

3. **Structured FSM log line.** After the failure UI renders, `grep '"event":"job_failed"' /tmp/dripv2-dev.log` must match a JSON line containing the right `job_id`, `preset_id`, `from=queued`, `reason=missing_api_key`.
4. **Rate limit on `POST /api/jobs`.** Per-session `capacity=3, refillPerSec=0.1`. Use a fresh cookie jar, upload ≥4 distinct PNGs (defeats idempotency), fire 5 rapid POSTs. Expect at least one `429` with header `Retry-After:` and body `{"error":"rate_limited","retryAfter":<int>}`. A `rate_limited` log line with `route:"POST /api/jobs"` and `reason:"session"` must appear in `/tmp/dripv2-dev.log`.
   - Gotcha: the limiter fires **before** request validation, so a `400 invalid body` still consumes a token. Plan for that when counting.
5. **Idempotency.** Fresh cookie jar, upload one PNG, POST `/api/jobs` twice with the same `(presetId, sourceImageId)` within ~1s. Both responses must contain the same `job.id`. Status of the second response is allowed to differ (the runner may have already short-circuited in between).

## Adversarial framing

For each test, ask: "would the same sequence look identical if the change were broken?" If yes, the test is too weak. The catalogue above is designed so:

- T1 fails (textarea reappears, RU button surfaces) if `PromptComposer` is re-mounted.
- T2 fails if the page renders the raw `errorReason` from the DB instead of the `friendlyFailure()` output.
- T3 fails if `logEvent` isn't called from the `submitJob` no-credentials branch.
- T4 fails if rate-limit middleware isn't installed (all 5 → 2xx).
- T5 fails if the request-hash dedup is broken (two distinct `id`s).

## Test artefacts

- DB rows: `pnpm prisma studio` opens a local UI at `http://localhost:5555`. The interesting tables are `GenerationJob`, `SourceImage`, `Preset`.
- Uploaded files: `public/uploads/images/<YYYY-MM-DD>/<uuid>.png`. Wiped if you delete `dev.db`.
- Structured logs: `/tmp/dripv2-dev.log` (only present if you started `pnpm dev` with `2>&1 | tee /tmp/dripv2-dev.log`).
- Cookie jars: keep separate ones per test (`/tmp/rl.cookies`, `/tmp/idem.cookies`) — sessions in `cookies` are how the rate-limit and idempotency buckets are keyed.

## Common pitfalls

- **Chrome console reports `Chrome is not in the foreground` after a screenshot.** Click into the page once before the next `browser_console` call, or skip console and use `curl` + `python3` for DOM substring assertions.
- **`/jobs/[id]` curl returns the loading state.** It's a client component. Use a screenshot for visual assertions.
- **Test PNG too small to upload?** No: `MAX_BYTES=12 MB`, `MIN` is effectively 1 byte. A 256×256 solid-colour PNG (~1 KB) is fine. Generate with PIL: `Image.new('RGB',(256,256),'#222').save('/tmp/test.png')`.
- **`ARK_API_KEY` accidentally set in shell env?** It overrides `.env`. Run `unset ARK_API_KEY` and restart `pnpm dev`.
- **Rate-limit not firing because the per-IP bucket is bigger than per-session.** Per-IP cap is 8, per-session is 3. Use a single fresh cookie jar — the per-session bucket is the one that fires first.

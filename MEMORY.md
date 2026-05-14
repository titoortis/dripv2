# MEMORY.md

> Working project state for agents. Read at the start of every session per `GELOAGENT.md`.
> Keep short, structured, factual. Trust repository evidence over this file; update when it drifts.

## Project
- Name: **dripv2** (`drip` brand) — mobile-first AI video MVP.
- Goal: Phone-first product where the user uploads one (eventually two) photo, picks a cinematic preset, and gets a stylized short video. No prompts, no auth, no admin.
- Current stage: **Live on production at https://drip-silk.vercel.app.** Backend (upload, presets, generation, wallet, rate limits, poller) is up and live-validated. Frontend on `/create` and the homepage `PresetLauncher` overlay are in active iteration. Image-gen pre-transform pipeline (OpenAI `gpt-image-2` → Seedance) shipped in PR #37 for `f1_pilot_v1`.

## Product Intent
- What the user wants to build: A **Higgsfield-style preset launcher**. Open a preset card → modal over a looping example video → two upload slots (**1) Selfie**, **2) Outfit / look reference**) → quality validation chips ("face good ✓ / bad ✗", "outfit good ✓ / bad ✗") → Generate. Under the hood, three stages: (a) generate a **character reference sheet** image from the two slots; (b) generate the **preset still** (first frame of the scene) from that sheet; (c) submit the still to **BytePlus Seedance 2.0** as `first_frame` with the per-preset video prompt; emit a 9:16 / 16:9 / etc. video at the resolution the user picked.
- Expected user experience: Looks and feels like Higgsfield's preset browser (see attachments in user's session). Card → overlay-over-video → two slots → Generate. No prompt fields. No technical jargon. "It just works" on mobile.
- Important behavior expectations:
  - Per-preset prompt pair: **image-prompt** (used for stage b — preset still) AND **video-prompt** (used for stage c — Seedance). Today only `f1_pilot_v1` has both (via `Preset.transformPromptTemplate` for the image side and `Preset.promptTemplate` for the video side); all other presets pass the user's raw photo straight into Seedance with `promptTemplate` only.
  - Stage a (reference sheet from selfie+outfit) does NOT exist in code yet. Today `gpt-image-2` is called as a single-image edit, not a multi-image compositing call. Adding stage a is the main outstanding pipeline change.
  - Aspect ratio + resolution are user-selectable in the UI and persisted on the job row (`GenerationJob.resolution` / `durationSec`); they flow into the Seedance task body verbatim.
  - Idempotency: SHA256 over `{presetId, sourceImageId, model, ratio, resolution, duration, generateAudio, promptTemplate}` keyed on `(sessionId, requestHash)` — same inputs reuse the same `GenerationJob` row. This will need to include the second slot's `sourceImageId` once dual-slot lands.

## Current Status
- What is already working (verified live on prod):
  - `/api/uploads` (S3/R2 storage adapter), `/api/presets`, `/api/jobs`, `/api/jobs/[id]`, `/api/wallet`, `/api/internal/poll`.
  - In-process job poller (`instrumentation.ts` → `src/lib/server/jobs/poller.ts`): 2s tick, 5–20s per-job backoff, 600s wall-clock cap, `expired` terminal state on timeout.
  - FSM: `queued → uploading → submitted → processing → completed | failed | cancelled | expired` in `src/lib/server/jobs/runner.ts`.
  - Entitlement wallet (paid-only MVP, no auto-trial): debit at job creation, refund on refundable error codes + `http_5*` fallback (`src/lib/server/wallet.ts`).
  - Rate limits: per-IP + per-session token bucket on `/api/uploads` and `/api/jobs`.
  - Reference-mode kill switch (`PROVIDER_REFERENCE_MODE_ENABLED`) gating which presets submit with `role="reference_image"` vs `role="first_frame"`.
  - **Pre-transform pipeline** (PR #37): when `Preset.transformPromptTemplate` is non-null, the runner fetches the source image, calls OpenAI Images Edit (`OPENAI_IMAGE_MODEL`, default `gpt-image-2`), persists the edited PNG to storage, and submits THAT URL to Seedance with `role="first_frame"`. Used by `f1_pilot_v1`.
  - Two-slot UI on `/create` (Primary live + Optional `comingSoon`) and homepage `PresetLauncher` overlay (Primary live + secondary `ComingSoonSlot`). The Optional slot is currently a non-interactive `<div role="img">` after PR #39 (was a `<button disabled cursor-not-allowed>` and looked broken to users).
- What was recently finished:
  - **PR #39** (just merged, 2026-05-14): UX fix — dropped the red 🚫 cursor and `<button disabled>` from both comingSoon reference slots; replaced with `<div role="img">`. Tested live on prod; all three assertions passed.
  - PR #38: Desktop UX refresh — larger pads, full preset grid, larger CTA on `/create`.
  - PR #37: `f1_pilot_v1` preset with **two-stage gpt-image-2 → Seedance** pipeline.
  - PR #36: Bump Next.js 14.2.15 → 14.2.35 for Cloudflare Workers compatibility.
  - PR #35: Prisma `provider="postgresql"` for prod; `prisma/schema.dev.prisma` kept on sqlite for local dev (parity enforced by `scripts/check-prisma-schemas.cjs`).
  - PR #34: UI disclosure + observability for `reference_images` mode.
  - PR #33: Log `role` on all job submit paths.
  - PR #32: Dark-launch `iron_hero_v1` + `fight_club_v1` flipped to `referenceMode="reference_images"` (kill-switch gated).
- What is currently in progress:
  - **This MEMORY.md bootstrap PR** — bringing the repo into compliance with `GELOAGENT.md`'s Session Start / Memory Discipline protocol.
  - Investigation of a failed prod job (`cmp4rlwyd0003uot23tw6dm59`) — `/jobs/[id]` returns `forbidden` to other sessions, so we need either a screenshot of the failure card from the owning user's browser or Vercel logs to read the `failureCode`/`failureMessage`.

## Planned Features
- **Dual-slot upload (selfie + outfit).** Today the right slot is `comingSoon`. Wire it as a real `UploadPad`, persist a second `SourceImage`, and add the FK to `GenerationJob` (e.g. `outfitSourceImageId`). Update the idempotency hash.
- **Stage 1 — character reference sheet generation.** Multi-image input to `gpt-image-2` (selfie + outfit) producing the multi-view reference sheet described in the user's prompt: front portrait + 3/4 + full-body with identity and clothing locked. Persist the result PNG to storage and feed it into stage 2.
- **Stage 2 — per-preset preset still generation.** Already exists as `Preset.transformPromptTemplate` + `runPreTransform()` in the runner. Extend so it consumes the stage-1 sheet (not the raw upload). Fan out beyond `f1_pilot_v1` so every preset has an image-prompt.
- **Stage 3 — video generation.** Already exists (`seedance.createImageToVideoTask`). No changes needed beyond piping the new first-frame URL.
- **Quality validation chips (face good/bad, outfit good/bad).** Run a Vision classifier on each uploaded slot before enabling Generate. Likely OpenAI `gpt-4o` / `gpt-5.5` vision with image input. UX: chip turns green/red under the slot.
- **Per-preset image + video prompt pair persisted on the `Preset` row.** Image-side already lives on `Preset.transformPromptTemplate`; just needs to be populated for every preset. Source of truth stays `src/lib/server/presets-source.ts` → `pnpm db:seed`.
- **`GenerationJob` FSM extensions** to surface stage-1 / stage-2 progress in the UI (`generating_reference_sheet → generating_preset_still → generating_video`). Today the user only sees `queued → uploading → submitted → processing` and waits ~minutes; intermediate stage feedback will help.

## Deferred / Not Now
- Real auth (Telegram or otherwise). MVP stays on anonymous `sessionId` cookie; merge story is forward-friendly via `User.sessionId`.
- Marketing mode (`NEXT_PUBLIC_LAUNCH_MODE=marketing`) — exists as a kill-switch for the landing-only build; live prod runs `full`.
- Custom prompt editing in the UI. Product is preset-only by design.
- Pricing packs / paid top-up flow. Wallet schema is ready; UI surface is "Out of credits" today.
- Creator presets, referral codes, royalties. Schema seams exist (`Preset.ownerUserId`, `ReferralCode`), no UI.

## Decisions
- [2026-05-14] **Image-gen provider = OpenAI `gpt-image-2`** (Images Edit endpoint, multipart upload). Selected by the user this session. Already wired via `src/lib/server/providers/openai-image.ts` (PR #37). Env: `OPENAI_API_KEY`, `OPENAI_BASE_URL` (default `https://api.openai.com/v1`), `OPENAI_IMAGE_MODEL` (default `gpt-image-2`).
- [2026-05-14] **Video-gen provider = BytePlus ModelArk Seedance 2.0** (model `dreamina-seedance-2-0-260128`). Endpoint: `POST /api/v3/contents/generations/tasks`, polled via `GET .../tasks/:task_id`. Env: `ARK_API_KEY`, `ARK_BASE_URL`, `ARK_DEFAULT_MODEL_ID`.
- [2026-05-14] **Storage driver = S3/R2** in prod via `@aws-sdk/client-s3`. Local dev uses `local` driver in `public/uploads`. The provider must be able to fetch source images from a public URL, so `APP_PUBLIC_BASE_URL` must be reachable by BytePlus.
- [2026-05-14] **Reference-mode is kill-switched.** `PROVIDER_REFERENCE_MODE_ENABLED` env gates whether a preset's `referenceMode="reference_images"` is honored at submit time. Off ⇒ runner forces `first_frame`. `iron_hero_v1` and `fight_club_v1` are flipped to `reference_images` (dark-launched in PR #32).
- [2026-05-14] **Pre-transform > reference-mode for `f1_pilot_v1`.** When `transformPromptTemplate` is set, the runner uses `role="first_frame"` and skips reference-mode entirely (the edited PNG IS the desired first frame; we don't need Seedance to do its own character lift on top). See `src/lib/server/jobs/runner.ts:98–103`.
- [2026-05-14] **Two Prisma schema files, parity-checked.** `prisma/schema.prisma` (postgresql, for prod) and `prisma/schema.dev.prisma` (sqlite, for local). Any model change must land in both files in the same commit; `scripts/check-prisma-schemas.cjs` enforces on `pnpm build`.

## Constraints
- **No auth.** Anonymous `sessionId` cookie. Don't add login flows without product approval.
- **No prompt input in the UI.** Preset-only product. Don't add a freeform prompt field to `/create` or the launcher overlay.
- **Don't touch backend / storage / reference-mode for UI-only tasks.** Per user instruction in the cursor-fix session: keep UI changes UI-scoped and don't co-mingle with backend changes.
- **Don't reset the DB while `pnpm dev` is running.** Prisma's open SQLite file handle stays pointed at the deleted inode and the next API call 500s with a valid storage file but no DB row. Kill dev → reset → restart. (See `.agents/skills/dev/SKILL.md`.)
- **Preset source of truth is `presets-source.ts`.** Edit it, run `pnpm db:seed`, never edit the UI to reflect a preset change.
- **Two Prisma schema files must stay byte-identical outside the `datasource db` block.** `pnpm build` fails loudly otherwise.
- **`ARK_API_KEY` may be empty in dev.** The runner short-circuits to terminal `failed:missing_api_key` in ~2s so the entire upload→preset→generate→/jobs/[id] flow is testable end-to-end without provider cost (see `.agents/skills/testing-dripv2/SKILL.md`).
- **Vercel runtime is read-only and ephemeral.** Generation pipeline depends on Postgres + S3 — local FS storage won't survive between requests on Vercel.

## Open Issues
- **Failed prod job `cmp4rlwyd0003uot23tw6dm59`.** Reported by user 2026-05-14. `/jobs/[id]` route returns `forbidden` to non-owning sessions, so the failure card and `errorCode` are not readable from another browser. Need either a screenshot of the failure UI from the user's browser or Vercel runtime logs filtered to this job id. Likely candidates: `OPENAI_API_KEY` missing in prod (would surface `errorCode="missing_api_key"` via `runPreTransform`), `gpt-image-2` model name mismatch (env default is `gpt-image-2`; account may only have `gpt-image-1`), or Seedance rejecting the edited PNG.
- **Stage 1 (reference sheet from selfie+outfit) not yet implemented.** Today the pre-transform pipeline is a single-image edit, not a multi-image composition. The user's vision requires this stage.
- **Only `f1_pilot_v1` has an image-prompt.** Other presets pass the user's raw upload directly to Seedance with `transformPromptTemplate=null`. Once dual-slot + stage-1 land, all presets need an image-prompt populated.
- **No face/outfit validation.** Users can upload anything (low-light face, no outfit, full-body shot, etc.) and the pipeline tries anyway. Validation chips are part of the planned UX.
- **Cloudflare Workers Build check is failing on PRs.** Optional, doesn't block merge; user told the cursor-fix session to leave Cloudflare/infra alone. Still on the radar.

## User Priorities
- Highest current priority: **ship the Higgs-style two-slot + reference-sheet pipeline.** Stage 1 is the main missing piece.
- Secondary priority: **keep UI consistent and trustworthy.** No fake / forbidden affordances, no overlapping cursors, no surprise "nothing happens on click". PR #39 was an example.
- What should not be broken: prod uploads, BytePlus image-to-video happy path, wallet ledger correctness, idempotency, the in-process poller.

## Next Steps
- 1. Investigate failed job `cmp4rlwyd0003uot23tw6dm59` — get `errorCode`/`errorReason` from the user's browser or Vercel logs.
- 2. Draft `docs/HIGGS_PIPELINE_PLAN.md` outlining: dual-slot upload (selfie + outfit) in UI + DB; stage-1 reference-sheet via `gpt-image-2` multi-image edit; stage-2 preset-still extension to consume stage-1 output; per-preset image-prompt population across all 13 presets; FSM extension for stage feedback in UI; PR slicing (PR-A: dual-slot upload + schema; PR-B: stage-1 reference sheet; PR-C: per-preset image-prompts; PR-D: validation chips).
- 3. Sync with user on the plan + provider configuration (confirm `OPENAI_API_KEY` is set on prod, confirm `OPENAI_IMAGE_MODEL=gpt-image-2` is the intended name and not `gpt-image-1`).

## Last Session
- Date: 2026-05-14
- Summary: Fixed a UX bug where the "Optional" reference slot on `/create` and in the homepage `PresetLauncher` overlay displayed a red 🚫 cursor and a `<button disabled>`, leading users to read the entire upload feature as broken. Replaced with `<div role="img">`, preserved the dashed-ring + opacity treatment, kept Primary upload untouched. PR #39 merged. End-to-end tested on prod with cursor-visible recording; all three assertions passed.
- Primary signal: Optional reference slots on prod no longer surface a forbidden cursor, Primary upload still opens the OS file picker and renders the preview.
- Secondary signals: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm build` clean, Vercel preview build passed, Vercel prod redeployed from `main`, prod DOM verified via `getComputedStyle` (Optional: `cursor: auto`, no `cursor-not-allowed` class; Primary: `cursor: pointer`).

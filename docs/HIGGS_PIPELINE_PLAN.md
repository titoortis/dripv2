# Higgsfield-style Generation Pipeline — Migration Plan

> Status: **DRAFT, awaiting product sign-off.** No code changes until each PR's contract is agreed.
> Author: agent, 2026-05-14. Update `MEMORY.md` whenever a decision below is taken.

## 1. Goal

Make the create flow behave like Higgsfield's preset launcher: open a preset card, see the example video looping behind a modal, attach **two photos (selfie + outfit reference)**, get quality validation chips, then Generate. Under the hood, run a **three-stage** pipeline so the output video features the user's face and outfit in the preset's cinematic scene:

| Stage | What it produces | Provider | Status today |
|---|---|---|---|
| 1 | **Character reference sheet** — composite image with the user's face + outfit (front + 3/4 + full-body) | OpenAI `gpt-image-2` (multi-image edit) | **NOT IMPLEMENTED** |
| 2 | **Preset still** — first frame of the preset's scene, restaged with the character from stage 1 | OpenAI `gpt-image-2` (image edit) | **PARTIAL** — exists for `f1_pilot_v1` only, single-image input |
| 3 | **Video** — animated short driven by the preset's video prompt, using the stage-2 still as `first_frame` | BytePlus ModelArk Seedance 2.0 | **DONE** |

## 2. Where we are today

Verified from `src/lib/server/jobs/runner.ts`, `src/lib/server/providers/openai-image.ts`, `prisma/schema.prisma`, and `src/lib/server/presets-source.ts`:

- The runner already has a **pre-transform step** (`runPreTransform`) gated by `Preset.transformPromptTemplate`. When non-null, it pulls the source image, calls `POST {OPENAI_BASE_URL}/images/edits` with `model=gpt-image-2`, persists the edited PNG to storage, and submits **that** URL to Seedance with `role="first_frame"`. The role label is forced to `first_frame` because the edited PNG **is** the desired first frame; reference-mode is skipped.
- Only `f1_pilot_v1` has `transformPromptTemplate` populated today. All other presets pass the user's raw upload straight to Seedance with `transformPromptTemplate=null`.
- The pre-transform step accepts exactly **one** image (multipart `image=<bytes>`) — the OpenAI Images Edit endpoint supports an array of `image[]` parts for multi-image editing, but the current wrapper doesn't use it.
- The `/create` UI has **two reference slots in `UploadPad` and `PresetLauncher`**, but the right slot is a non-interactive `<div role="img">` (`comingSoon`). The Primary slot is the only wired upload. `POST /api/jobs` only accepts a single `sourceImageId`.
- Idempotency hash (`src/lib/server/jobs/hash.ts`) covers `{presetId, sourceImageId, modelId, ratio, resolution, durationSec, generateAudio, promptTemplate}` and optionally `referenceMode`.
- The FSM is `queued → uploading → submitted → processing → completed|failed|cancelled|expired`. The pre-transform step happens **inside** the `uploading` transition — there is no surfaced stage for "running OpenAI Images Edit". From the `/jobs/[id]` UI the user just sees `submitting…` for the full duration of stages 1 + 2 + Seedance task creation.

## 3. Target architecture

```
Browser
  POST /api/uploads (selfie)       → SourceImage row A
  POST /api/uploads (outfit ref)   → SourceImage row B
  POST /api/jobs { presetId, selfieSourceImageId: A, outfitSourceImageId: B,
                   resolution, durationSec }

Server (runner)
  ┌── stage 1 ───────────────────────────────────┐
  │ openAiImage.composeReferenceSheet({          │
  │   images: [selfie.url, outfit.url],          │
  │   prompt: REFERENCE_SHEET_PROMPT,            │
  │   size: "1024x1536", quality: "high",        │
  │ }) → PNG buffer → storage.put → publicUrl    │
  └──────────────────────────────────────────────┘
                  │
                  ▼ refSheetImageId persisted on job
  ┌── stage 2 ───────────────────────────────────┐
  │ openAiImage.editImage({                      │
  │   sourceImageUrl: refSheet.url,              │
  │   prompt: preset.transformPromptTemplate!,   │
  │   size: "1024x1536", quality: "high",        │
  │ }) → PNG buffer → storage.put → publicUrl    │
  └──────────────────────────────────────────────┘
                  │
                  ▼ presetStillImageId persisted on job
  ┌── stage 3 ───────────────────────────────────┐
  │ seedance.createImageToVideoTask({            │
  │   imageUrl: presetStill.url,                 │
  │   promptText: preset.promptTemplate,         │
  │   role: "first_frame", ratio, resolution,    │
  │   durationSec, generateAudio,                │
  │ }) → providerTaskId                          │
  └──────────────────────────────────────────────┘
```

### FSM extension

`queued → uploading → generating_reference_sheet → generating_preset_still → submitted → processing → completed|failed|cancelled|expired`

- `generating_reference_sheet` — set right after the row leaves `uploading`, before the stage-1 OpenAI call.
- `generating_preset_still` — set after stage 1 success, before the stage-2 OpenAI call.
- `submitted` — set after stage 2 success, when the Seedance task is created (matches today's semantics).
- `failed` reachable from any of the new states; refund policy via existing `maybeRefundJob`.

The `/jobs/[id]` UI surfaces these as user-facing copy: "Building your reference sheet…", "Restaging the scene…", "Rendering the video…".

## 4. UX changes (mobile-first)

### `/create` page

- Left slot stays Primary, **labeled "Selfie"**. Same `UploadPad` semantics as today.
- Right slot becomes Live, **labeled "Outfit / look reference"**. Same `UploadPad` semantics, separate `inputRef`, separate `POST /api/uploads`.
- Under each slot, a validation chip (initially empty, populates after upload):
  - Selfie: `Face detected ✓` (green) / `No face / multiple faces ✗` (red) / `Checking…` (grey)
  - Outfit: `Full outfit visible ✓` (green) / `Crop too tight ✗` (red) / `Checking…` (grey)
- `Generate` CTA disabled until both slots are populated AND both chips are green (or override forced via a "Use anyway" sub-link for power users).
- Aspect-ratio + resolution picker unchanged.

### Homepage `PresetLauncher` overlay

- Same two-slot UX inside the overlay (already a `comingSoon` slot today, just wire it the same way).

### `/jobs/[id]` page

- Status copy reflects new FSM states (3 new strings, no new screens).
- Both source images thumbnailed under "Inputs" instead of one.

## 5. Data model deltas (Prisma)

Mirror to both `prisma/schema.prisma` (postgresql) and `prisma/schema.dev.prisma` (sqlite). `scripts/check-prisma-schemas.cjs` enforces parity.

### `Preset`

```prisma
model Preset {
  …
  /// Optional stage-1 prompt. When non-null, the runner generates a
  /// character reference sheet from {selfie, outfit} before running
  /// `transformPromptTemplate`. Null means "skip stage 1, feed the
  /// selfie directly into stage 2 (legacy single-image edit)".
  referenceSheetPromptTemplate String?
  …
}
```

> Rationale: keeping stage-1 prompt per-preset (instead of a single global constant) lets us tune the reference-sheet style per look (e.g. F1 wants studio-clean reference, Iron Hero wants high-contrast superhero reference). Default to null means stage 1 is opt-in per preset and the current single-stage `f1_pilot_v1` still works unchanged.

### `GenerationJob`

```prisma
model GenerationJob {
  …
  /// Selfie source image. Renames `sourceImageId` for clarity.
  /// Kept as `sourceImageId` at the column level to avoid a destructive
  /// rename; the new accessor is `selfieSourceImageId` in app code.
  sourceImageId String

  /// Outfit reference source image. Nullable so jobs created before this
  /// PR continue to be valid (and so single-slot presets that ignore
  /// outfit can still run).
  outfitSourceImageId String?
  outfitSourceImage   SourceImage? @relation("OutfitImage", fields: [outfitSourceImageId], references: [id])

  /// Stage-1 output (character reference sheet PNG persisted in our
  /// storage). Null until stage 1 completes. Resolved via the new
  /// `RefSheetImage` row OR by reusing `SourceImage` polymorphically
  /// — open question below.
  refSheetImageId String?

  /// Stage-2 output (preset still PNG). Today's `runPreTransform`
  /// writes this PNG to `storage` but doesn't persist a row; this
  /// PR adds a row so the UI can show the still while the video
  /// renders.
  presetStillImageId String?
  …
}
```

Open question: do we add `RefSheetImage` and `PresetStillImage` models (1:1 with `GenerationJob`), or reuse `SourceImage` and add a `kind` column? **Recommendation: reuse `SourceImage`** + add `kind String @default("user_upload")` with values `user_upload | reference_sheet | preset_still`. Simpler storage, single asset table, easier garbage-collection path.

### Idempotency hash

`src/lib/server/jobs/hash.ts` adds:
- `outfitSourceImageId` (omitted from canonical string when null, for backward stability)
- `referenceSheetPromptTemplate` (omitted when null, ditto)

## 6. API contract changes

### `POST /api/uploads`

No shape change. Same `multipart/form-data` upload with `file` field. Adds an optional `kind` query param (`?kind=selfie|outfit`) only to surface in structured logs — doesn't gate behavior.

### `POST /api/jobs`

```ts
const CreateBody = z.object({
  presetId: z.string().min(1),
  sourceImageId: z.string().min(1),         // selfie (kept for back-compat)
  outfitSourceImageId: z.string().min(1).optional(), // new
  resolution: z.enum(["480p", "720p", "1080p"]).optional(),
  durationSec: z.union([z.literal(5), z.literal(10), z.literal(15)]).optional(),
});
```

When the preset has `referenceSheetPromptTemplate` set:
- `outfitSourceImageId` is **required**; 400 with `errorCode="missing_outfit_image"` otherwise.
- The hash includes both source ids; the idempotency contract becomes (selfie + outfit + preset + ratio + resolution + duration + audio + promptTemplate + referenceSheetPromptTemplate + transformPromptTemplate).

When the preset has `referenceSheetPromptTemplate=null`:
- `outfitSourceImageId` is ignored; legacy single-slot behavior. This lets us roll out dual-slot per-preset (`iron_hero_v1` first, etc.) without forcing every preset to break.

### `GET /api/jobs/[id]`

Adds `outfitSourceImage`, `refSheetImage`, `presetStillImage` to the response shape, all nullable. UI shows whichever are present.

## 7. OpenAI Images Edit — multi-image call

`src/lib/server/providers/openai-image.ts` gets a second function:

```ts
async composeReferenceSheet(input: {
  imageUrls: string[];           // [selfie, outfit]
  imageMimeTypes: string[];      // parallel array
  prompt: string;
  size?: OpenAiImageSize;
  quality?: OpenAiImageQuality;
}): Promise<EditImageOutput>
```

Sends a multipart body with **multiple `image[]` parts** (per OpenAI Images Edit reference for multi-image). All other shape mirrors `editImage`. Throws `OpenAiImageError` on non-2xx.

## 8. Env additions / verification

Already in `src/lib/server/env.ts` (no new vars):
- `OPENAI_API_KEY` — **must be set on Vercel prod** for any preset that opts in to stage 1 or stage 2. Today it's only required for `f1_pilot_v1`; after this rollout it's required for every preset that opts in.
- `OPENAI_BASE_URL` (default `https://api.openai.com/v1`).
- `OPENAI_IMAGE_MODEL` (default `gpt-image-2`). **Open question:** does the user's account expose `gpt-image-2`, or is it still `gpt-image-1`? Confirm before PR-B (stage 1) lands.

PR-A surfaces a startup `logEvent("openai_image_credentials", { configured })` so a Vercel log filter can verify.

## 9. PR slicing

Each PR is independently mergeable and individually reviewable.

### PR-A — Dual-slot upload + schema seam
- **Code**: rename internal `UploadPad` props so the existing Primary is `slot="selfie"`; wire the right slot live with `slot="outfit"`. Adjust `PresetLauncher` overlay analogously. `POST /api/uploads` accepts optional `?kind=outfit` for log labels.
- **Schema**: add `Preset.referenceSheetPromptTemplate String?`, `GenerationJob.outfitSourceImageId String?`, `SourceImage.kind String @default("user_upload")`. Mirror to both Prisma schemas.
- **Hash**: include `outfitSourceImageId` + `referenceSheetPromptTemplate` (both omitted when null, backward stable).
- **API**: `POST /api/jobs` accepts optional `outfitSourceImageId`. No preset has `referenceSheetPromptTemplate` populated yet, so behavior is identical to today.
- **UI**: outfit slot is wired but visually subdued until the user clicks Generate; no validation chips yet.
- **Acceptance**: existing `f1_pilot_v1` flow still works end-to-end on prod; new outfit slot accepts upload and the URL appears in structured logs; CI green.

### PR-B — Stage 1 reference-sheet generation
- **Provider**: add `openAiImage.composeReferenceSheet(...)` with the multi-image `image[]` multipart shape.
- **Runner**: when `preset.referenceSheetPromptTemplate` is set AND `outfitSourceImageId` is non-null, run stage 1 between `uploading → generating_reference_sheet`, persist the PNG to storage as `SourceImage(kind="reference_sheet")`, set `GenerationJob.refSheetImageId`, then feed `refSheet.publicUrl` into the existing stage-2 `runPreTransform` (which becomes a no-op for legacy single-stage presets).
- **FSM**: add `generating_reference_sheet` and `generating_preset_still` states (already-failed jobs unaffected).
- **UI (`/jobs/[id]`)**: friendly copy for the new states. Stage-1 PNG thumbnailed under "Inputs" once available.
- **Preset**: populate `referenceSheetPromptTemplate` on **one** preset (suggest `iron_hero_v1` since it's the lowest-risk current `reference_images` preset). Other presets stay on the legacy path.
- **Idempotency**: `referenceSheetPromptTemplate` joins the hash (omitted when null).
- **Acceptance**: pick a preset opted in, upload selfie + outfit, see all three FSM transitions in the UI, watch a video render whose first frame is clearly the reference sheet restaged. Job completes within wall-clock cap (600s). Refunds on stage-1/stage-2 failure work via `maybeRefundJob`.

### PR-C — Roll out per-preset image-prompts
- For every preset (13 today), author both `referenceSheetPromptTemplate` and `transformPromptTemplate`, using `f1_pilot_v1` as the template.
- Bump `sortOrder` if product wants the dual-slot presets to lead.
- `pnpm db:seed` upserts the new prompt columns; old rows get updated.
- No runner changes.
- **Acceptance**: every preset opens, accepts both slots, and renders a video that recognizably uses the user's face + outfit.

### PR-D — Face / outfit validation chips
- New module `src/lib/server/providers/openai-vision.ts` calling `gpt-4o`/`gpt-5.5` (whatever the user picks) with each upload as image input + a Yes/No prompt ("Does this photo clearly show a single human face suitable for a character reference? Reply with `yes` or `no` and a short reason.").
- New `POST /api/uploads/validate` endpoint returning `{ ok: bool, reason: string }`.
- Client calls it right after upload, renders the chip.
- Server-side enforcement at `POST /api/jobs` is **off** initially — chip is advisory. Power users can hit Generate with a red chip. We'll flip the server gate on after a few days of metrics.
- **Acceptance**: chip flickers `Checking…` then settles green or red within ~2s; bad selfies (no face, multiple faces, low res) reliably surface red.

### PR-E — UI polish + FSM stage feedback
- New copy and progress states on `/jobs/[id]` matching the FSM extension.
- Higgs-style preset overlay refinements (looping example video, clearer slot labels, validation chip placement). Behind-the-modal play stays the same.

## 10. Risks

- **Cost.** Stage 1 + stage 2 = 2× `gpt-image-2 (high quality, 1024x1536)` calls per video. Last published pricing is ~$0.04–0.08 per image at high quality, so ~$0.10–0.20 of OpenAI cost per video on top of Seedance. Wallet balance is still 1 credit per video — need a product decision on whether to absorb or reprice.
- **Latency.** Stage 1 and stage 2 add ~10–20s each. Wall-clock cap stays at 600s; safe margin, but the UI must stream FSM transitions or users abandon.
- **OpenAI account limits.** Multi-image editing may be rate-limited or quota-gated. PR-B should add a clear `errorCode="image_provider_rate_limited"` mapping for HTTP 429 from OpenAI.
- **`gpt-image-2` model name.** The env default is `gpt-image-2`; if the user's account is still on `gpt-image-1`, every job fails. Verify in PR-A by reading prod env on Vercel.
- **Idempotency drift.** Adding fields to the hash will cause new jobs to compute different hashes than legacy jobs — that's by design. Existing rows are unaffected.
- **Failed prod job `cmp4rlwyd0003uot23tw6dm59`.** Cause unknown until we read the failure card. Hypotheses: missing `OPENAI_API_KEY` on prod, wrong `OPENAI_IMAGE_MODEL`, Seedance rejected the edited PNG. **Surface the `errorCode` before starting PR-B** so we don't ship more code on top of a broken existing pipeline.

## 11. Open decisions (need user input)

1. **Image model name.** Stay on env default `gpt-image-2`, or pin to `gpt-image-1`? (verify the user's OpenAI account)
2. **Reference-sheet style.** Single composite (front + 3/4 + full-body in one PNG) per the user's existing prompt, or three separate PNGs handed to stage 2? Recommendation: stick with single composite — simpler runner, simpler storage, matches the prompt the user already wrote.
3. **Server-side validation enforcement.** Chip-only (advisory), or hard-gate at `POST /api/jobs`?
4. **Pricing.** Keep 1 credit = 1 video given the new OpenAI overhead, or refactor wallet pricing?
5. **Stage-1 rollout preset.** Start with `iron_hero_v1` or another preset?

## 12. What changes in MEMORY.md after each PR

PR-A merge → update `Current Status / What is already working` to note dual-slot upload + new schema columns; `Decisions` adds 2026-MM-DD: dual-slot rolled out.
PR-B merge → `Current Status` adds stage-1 reference sheet; `Open Issues` drops "stage-1 not implemented".
PR-C merge → `Current Status` notes per-preset image prompts populated.
PR-D merge → `Current Status` adds validation chips; `Decisions` records the vision model.
PR-E merge → `Current Status` notes FSM stage feedback in UI.

Per `GELOAGENT.md`, MEMORY.md must be updated in the same PR as the change it records.

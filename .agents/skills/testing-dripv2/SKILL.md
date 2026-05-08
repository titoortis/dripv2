---
name: testing-dripv2
description: End-to-end test the dripv2 upload → preset → generate → /jobs/[id] flow locally without any provider credentials. Use when verifying landing/CTA changes, friendly failure UI, FSM transitions, structured logs, rate limits, or the entitlement wallet (debit / refund / 402 / out-of-credits UI). PR 3+ also covers live Seedance validation when ARK_API_KEY is provided. Skip when the change is provider-shape only (no UI, no FSM, no rate-limit, no wallet) — a unit/typecheck pass is enough there.
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
- **Entitlement wallet (PR 2+, retrofit in PR 3)** — `src/lib/server/wallet.ts`, `src/lib/server/users.ts`, `src/app/api/wallet/route.ts`, the WalletBanner on `src/app/create/page.tsx`, the 402 no_credits branch in `src/app/api/jobs/route.ts`, and the `maybeRefundJob` seam in `runner.ts`. **PR 3 contract:** paid-only MVP — there is no auto-trial; new users start at `balance=0` and stay there until a paid pack lands (future PR) or you manually top up via the Prisma snippet below.
- **Live Seedance (PR 3+)** — `src/lib/server/providers/seedance.ts`, the `submitJob`/`pollJob`/`finalize` paths in `runner.ts`, and result-video persistence.

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

## Cold-visit / clean-state pattern

Clearing the browser cookie alone is **not enough** to reset to a true first-visit state because:
- the `dripv2_sid` cookie is `httpOnly`, so JS can't delete it;
- even with a fresh cookie, the previous user's wallet rows still exist in the DB and would shadow the test if anything queried by `userId`;
- wallet rows are keyed by `userId`, and `trialGrantedAt` is a forward-only seam (no MVP writer) — stale rows still shadow tests by `userId` if you don't wipe.

Wipe the entitlement state directly via Prisma (and the chrome cookie at most loses you context, doesn't break anything):

```js
node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{
  await p.jobLedgerEntry.deleteMany({});
  await p.entitlementWallet.deleteMany({});
  await p.user.deleteMany({});
  await p.generationJob.deleteMany({});
  await p.resultVideo.deleteMany({});
  await p.sourceImage.deleteMany({});
  await p.\$disconnect();
})()"
```

Then reload `/create` — the page calls `GET /api/wallet`, which mints a fresh `User` and an `EntitlementWallet` at `balance=0`. The new user is keyed by whatever `dripv2_sid` cookie the server set previously; what matters is that there is no `EntitlementWallet` row yet (the wipe handles that).

## Expected FSM behavior with no ARK_API_KEY

- `POST /api/jobs` immediately creates a row with `status=queued` (and decrements the wallet by 1 in the same tx — see PR 2).
- `submitJob` runs in-process within ~1–2s and **short-circuits before flipping to `uploading`** when `seedance.hasCredentials()` is false. The job ends at `status=failed`, `errorCode=missing_api_key`.
- The runner emits exactly one structured log line:
  ```json
  {"event":"job_failed","job_id":"...","preset_id":"...","from":"queued","reason":"missing_api_key"}
  ```
- **PR 2 (kept in PR 3):** the same path also calls `maybeRefundJob(jobId)`, which writes a `wallet_refunded` log line and credits the wallet back. Net effect on a **manually-topped-up** wallet: balance goes 1 → 0 → 1 within ~2s. Cold-visit users (`balance=0`) never get past the 402 gate — to exercise the refund path locally you must dev-top-up first (see below).
- `/jobs/[id]` (client component) polls `/api/jobs/[id]` and flips to the failed view with friendly copy (NOT the raw `errorReason` from the DB).

If you see a `queued → uploading` transition followed by a `submitted` line, that means the runner thinks credentials ARE configured. Recheck `.env`.

## Test catalogue

### UI tests (record these — `recording_start` before, `recording_stop` after)

1. **Landing renders preset-first CTA, no public prompt input.**
   - `curl -sS http://localhost:3000/` and assert: `'Pick a preset' in html`, `'/create'` href present, `0` `<textarea>` elements, **no** Russian `Сделать промпт`.
   - Click the `Pick a preset` button → URL becomes `/create`.
2. **`/create` cold visit shows OUT OF CREDITS.** After the cold-visit DB wipe above, navigate to `/create`. Banner eyebrow must read `OUT OF CREDITS` in **danger** (red) color and body copy must be exactly `Pricing packs land soon.`. Bottom CTA label must read `Out of credits` and the button must be **disabled**. PR 3 paid-only contract — no trial, ever.
3. **Friendly failure UI on `/jobs/[id]`.**
   - From `/create`, click upload pad → select a small PNG. Auto-selects the first preset. Tap `Generate`.
   - Wait ~3s. Take screenshot. Page must show `NOT READY YET` eyebrow, `Generation is not available on this build.` headline, `code: missing_api_key` footer, and **must not** contain the substring `ARK_API_KEY`.
   - Note: `/jobs/[id]` is a `"use client"` component, so `curl` returns only the loading scaffold. **Use a browser screenshot for the friendly-copy assertion**, not curl.
4. **Refund restores credits banner.** Prerequisite: dev-top-up the wallet to 1 (snippet below). From `/create`, generate → land on the failure screen → click `Try another preset` → back on `/create`. Banner must read `CREDITS · 1 video ready to use. Pick a preset.` again — i.e. the refund seam fired on `missing_api_key`. If it stays at `OUT OF CREDITS`, `runner.ts` is missing a `maybeRefundJob` call somewhere.
5. **Out-of-credits UI.** Cold visit (post-DB-wipe) is already this state — see T2. The same state is reachable mid-session by manually setting `balance=0`:
   ```js
   node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{await p.entitlementWallet.updateMany({data:{balance:0}});await p.\$disconnect();})()"
   ```
   Hard-reload `/create`. Same assertions as T2.

### Shell tests (no recording — capture stdout instead)

6. **Structured FSM log line.** After the failure UI renders, `grep '"event":"job_failed"' /tmp/dripv2-dev.log` must match a JSON line containing the right `job_id`, `preset_id`, `from=queued`, `reason=missing_api_key`. PR 2 adds a parallel `wallet_refunded` line for the same `job_id`.
7. **Rate limit on `POST /api/jobs`.** Per-session `capacity=3, refillPerSec=0.1`. Use a fresh cookie jar, upload ≥4 distinct PNGs (defeats idempotency), fire 5 rapid POSTs. Expect at least one `429` with header `Retry-After:` and body `{"error":"rate_limited","retryAfter":<int>}`. A `rate_limited` log line with `route:"POST /api/jobs"` and `reason:"session"` must appear in `/tmp/dripv2-dev.log`.
   - Gotcha: the limiter fires **before** request validation, so a `400 invalid body` still consumes a token. This is **intentional** fail-closed policy, codified in `rate-limit.ts`'s header comment as of PR 1 acceptance.
8. **Idempotency.** Fresh cookie jar, upload one PNG, POST `/api/jobs` twice with the same `(presetId, sourceImageId)` within ~1s. Both responses must contain the same `job.id`. Status of the second response is allowed to differ (the runner may have already short-circuited in between).
9. **Idempotency does NOT double-debit (PR 2+).** Same as 8, but also assert `GET /api/wallet` reports the same balance after the second POST as after the first — the dedup branch must run *before* the debit transaction. Ledger must contain exactly one `debit` entry for that `jobId`.
10. **402 no_credits gate (PR 2+).** Drain the wallet to 0 via Prisma. POST `/api/jobs` must return `402 {"error":"no_credits","balance":0}`. Without the entitlement gate this would 201-create-and-then-fail-on-decrement.
11. **Ledger audit (PR 3+).** After T4 (manual top-up + generate + refund), dump the session's ledger:
    ```js
    node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{const u=await p.user.findUnique({where:{sessionId:'<sid>'},include:{ledgerEntries:{orderBy:{createdAt:'asc'}},wallet:true}});console.log('balance:',u.wallet.balance);for(const e of u.ledgerEntries)console.log({type:e.type,amount:e.amount,reason:e.reason,jobId:e.jobId});await p.\$disconnect();})()"
    ```
    Must contain exactly `[grant(dev_topup), debit(generation), refund(missing_api_key)]` (or `[debit, refund]` if the dev-top-up snippet skipped writing a ledger row — not recommended). **A fresh, browse-only session must have an empty ledger** (zero rows). PR 3 retracted the trial auto-grant, so there is no longer a `grant(trial)` row.
12. **Schema seams populated (PR 2+).** All `Preset` rows must have `visibility="platform"`, `royaltyBps=0`, `ownerUserId=null`. New `GenerationJob` rows must have `userId` set; `creatorUserId` and `referralCodeId` must be `null` in MVP.

## Adversarial framing

For each test, ask: "would the same sequence look identical if the change were broken?" If yes, the test is too weak. The catalogue above is designed so:

- T1 fails (textarea reappears, RU button surfaces) if `PromptComposer` is re-mounted.
- T2 fails if the danger branch of `WalletBanner` (or the disabled-Generate-when-balance=0 wiring) is missing.
- T3 fails if the page renders the raw `errorReason` from the DB instead of the `friendlyFailure()` output.
- T4 fails if `runner.ts` doesn't call `maybeRefundJob` from the `missing_api_key` short-circuit — banner stays red.
- T5 fails if the `outOfCredits` derived state isn't wired to the bottom CTA, or if the danger-color branch of `WalletBanner` is missing.
- T6 fails if `logEvent` isn't called from the right places.
- T7 fails if rate-limit middleware isn't installed (all 5 → 2xx).
- T8 fails if the request-hash dedup is broken (two distinct `id`s).
- T9 fails if the dedup check is moved AFTER the debit tx (balance drops twice).
- T10 fails if the entitlement gate in `/api/jobs` is removed.
- T11 fails if any of `grant`/`debit`/`refund` writes are missing or duplicated.
- T12 fails if the schema seams aren't populated (or `userId` isn't set on new jobs).

## Test artefacts

- DB rows: `pnpm prisma studio` opens a local UI at `http://localhost:5555`. The interesting tables are `User`, `EntitlementWallet`, `JobLedgerEntry`, `GenerationJob`, `SourceImage`, `Preset`.
- Uploaded files: `public/uploads/images/<YYYY-MM-DD>/<uuid>.png`. Wiped if you delete `dev.db`.
- Structured logs: `/tmp/dripv2-dev.log` (only present if you started `pnpm dev` with `2>&1 | tee /tmp/dripv2-dev.log`).
- Cookie jars: keep separate ones per test (`/tmp/rl.cookies`, `/tmp/idem.cookies`) — sessions in `cookies` are how the rate-limit, idempotency, and **wallet** buckets are keyed.

## Common pitfalls

- **Chrome console reports `Chrome is not in the foreground` after a screenshot.** Click into the page once before the next `browser_console` call, or skip console and use `curl` + `python3` for DOM substring assertions.
- **`/jobs/[id]` curl returns the loading state.** It's a client component. Use a screenshot for visual assertions.
- **Test PNG too small to upload?** No: `MAX_BYTES=12 MB`, `MIN` is effectively 1 byte. A 256×256 solid-colour PNG (~1 KB) is fine. Generate with PIL: `Image.new('RGB',(256,256),'#222').save('/tmp/test.png')`.
- **`ARK_API_KEY` accidentally set in shell env?** It overrides `.env`. Run `unset ARK_API_KEY` and restart `pnpm dev`.
- **Rate-limit not firing because the per-IP bucket is bigger than per-session.** Per-IP cap is 8, per-session is 3. Use a single fresh cookie jar — the per-session bucket is the one that fires first.
- **Wallet still 0 after expected refund.** Check that the failure path you're exercising has a refundable `errorCode`. Refundable: `missing_api_key`, `wall_clock_timeout`, `succeeded_without_url`, `download_failed`, `internal_error`, anything `http_5*`. **Not refundable:** provider 4xx (bad photo, user fault) and `cancelled`.
- **Cold-visit test still shows a non-empty wallet.** Cookie clearing alone won't reset it because the cookie is httpOnly and the previous user's `EntitlementWallet` row still exists keyed by `userId`. Use the DB-wipe pattern at the top of this skill instead.
- **`POST /api/jobs` returns 402 unexpectedly.** PR 3 paid-only — a cold-visit wallet is `balance=0` and 402 is the correct response. To exercise generate paths locally you must dev-top-up first (see below). If you topped up and *still* get 402 on a second job, the previous job's refund probably didn't fire — check `/tmp/dripv2-dev.log` for the matching `wallet_refunded` line.

## Manual dev top-up (PR 3+)

Because MVP is paid-only and there's no purchase flow yet, the only way to exercise the generate path locally is to top up the wallet directly via Prisma. Use **upsert** so the snippet works for both fresh and existing wallets, and write a matching ledger entry so audits stay coherent:

```js
node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{
  const sid='<sessionId from cookie jar>';
  const u=await p.user.findUnique({where:{sessionId:sid}});
  if(!u){console.error('no user for sid');process.exit(1);}
  const N=1; // top-up amount
  await p.entitlementWallet.upsert({
    where: {userId:u.id},
    update:{balance:{increment:N}},
    create:{userId:u.id,balance:N},
  });
  await p.jobLedgerEntry.create({
    data:{userId:u.id,type:'grant',amount:N,reason:'dev_topup',jobId:null},
  });
  console.log('topped up',u.id,'+'+N);
  await p.\$disconnect();
})()"
```

Use `reason:'dev_topup'` (NOT `'trial'`) so production audits can distinguish.

## Live Seedance validation (PR 3+)

When you have an `ARK_API_KEY`:

1. Set the key in `.env` (do NOT log it). Restart `pnpm dev` so the next-server reads the new env.
2. Verify the key is loaded: `curl -sS http://localhost:3000/api/jobs -X POST` (no body, will 400) and confirm the next request you actually fire goes through `submitJob` (not the missing_api_key short-circuit).
3. Dev-top-up the wallet to 1 (snippet above).
4. From `/create`, upload a small portrait PNG, pick a preset, tap Generate.
5. Watch `/tmp/dripv2-dev.log` for the FSM transitions: `queued → uploading → submitted → processing → completed`. Each is its own structured `job_transition` line.
6. The `/jobs/[id]` page should land on the completed view with a playable video URL.
7. Verify the ledger has one `debit(generation)` row and **no** `refund` row (happy path).

For the negative-half (provider 4xx must NOT refund), a synthetic test is to upload an obviously-out-of-distribution image (e.g. a blank white PNG) and confirm: `errorCode` starts with `http_4` (or a normalized provider-rejection code), the job ends `failed`, the ledger has the `debit` row but **no** `refund` row, and the wallet stays at 0. If a 4xx ever produces a refund row, `isRefundableErrorCode` is wrong.

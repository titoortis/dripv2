# Vercel Production Sync Investigation

> Investigation timestamp: 2026-05-09 09:57 UTC.
> Production URL under investigation: `https://drip-silk.vercel.app/` (the only Vercel domain referenced in the project record — see PR #5 description).

This report is restricted to **publicly observable evidence**: GitHub repository state and HTTP responses from the production URL. Vercel dashboard / Vercel API access (deployment list, build logs, alias state, Git integration settings) is **not available** in this session — no Vercel token in secrets, no MCP server reachable, no `.vercel/` directory in the repo. Where the truthful answer needs Vercel-internal data, it is marked **N/A — needs Vercel access**, not guessed.

---

## GitHub

### Latest `main` commit SHA

```
f6936c52b5e892005bb04e59fb936722e1dfb917   (HEAD -> main)
2026-05-09 14:48:53 +0500  (= 09:48 UTC, 9 minutes before this report)
Merge pull request #16 from titoortis/devin/update-skills-1778320060
```

### Latest relevant PR merges (newest first)

| PR | Merge SHA | Merge time (+0500) | Affects deployable code? | Subject |
|---|---|---|---|---|
| **#16** | `f6936c5` | 2026-05-09 14:48:53 | **No** — `.agents/skills/testing-dripv2/SKILL.md` only | Update testing-dripv2 skill |
| **#15** | `cf71af7` | 2026-05-08 23:48:42 | **Yes** — first-preset launcher | Homepage: interactive first-preset card + Higgs-style launch overlay |
| #14 | `095d9b0` | 2026-05-08 22:53:25 | Yes | PR 6 follow-up runtime guards |
| #13 | `b806e83` | 2026-05-08 22:22:15 | Yes | PR 6: quality picker + variable pricing |
| #12 | `033d5d0` | 2026-05-08 21:24:29 | Yes | PR 5: preset capability fields |
| #11 | `7c7f356` | 2026-05-08 21:02:31 | Yes | Live Seedance validation |
| #10 | `7e60884` | 2026-05-08 18:09:51 | Yes | PR 3 rollback / trial-live-seedance |
| #9  | `bddb52b` | 2026-05-08 17:26:43 | No — skill |
| #8  | `55b70a1` | 2026-05-08 17:26:34 | Yes | PR 2: entitlement trial |
| #7  | `2030b7f` | 2026-05-08 16:52:27 | No — skill |
| **#6**  | `cee50c9` | 2026-05-08 16:37:52 | **Yes** — removed `PromptComposer` | PR 1: tighten MVP, preset-first landing |
| #5  | `929dcfd` | 2026-05-08 14:17:18 | Yes | Neuralyn-style landing (drip) |
| #4  | `ff05eb0` | 2026-05-07 23:57:18 | Yes | Vercel marketing-only mode + hero video URL |

PR #15 is the user-facing surface expected to be live ("Featured preset" section, Higgs-style launcher). PR #6 is the boundary marker that — as we'll see — production has clearly **not** crossed.

---

## Vercel

### Latest production deployment SHA

**N/A — needs Vercel access.** I cannot list deployments without a Vercel API token or dashboard login. What I can prove from the deployed HTTP response:

- `https://drip-silk.vercel.app/` returns **HTTP 200**, served by Vercel (`server: Vercel`, `x-vercel-id: pdx1::b7fnk-...`).
- `x-vercel-cache: HIT`, `age: 133386` (≈ **37 hours, 4 minutes** stale at the edge as of investigation time). No `x-vercel-deployment-url` is exposed publicly on this host, so the underlying deployment id is not derivable from headers alone.
- The HTML body **uniquely matches PR #5's branch tip** (`fb8ff8f`) — see "Deployed-content fingerprint" below — which means the deployment was built from a tree at or before `fb8ff8f` (the tip of `devin/1778182015-neuralyn-landing-prod`) or its merge commit `929dcfd` on `main`. The deployment is therefore **at the PR #5 era**.

### Latest preview deployment SHA

**N/A — needs Vercel access.** No preview URL has been linked from any PR in this repo (PRs #4–#16 all show `0 checks`, no GitHub-Actions / Vercel-bot status checks, no preview-link bot comments). This in itself is a strong signal that **the Vercel ↔ GitHub integration is not posting preview deployments back to PRs** — either the integration is disabled, was never installed on this org/repo, or is misconfigured.

### Deployment times

**N/A — needs Vercel access.** Best public proxy:

- Edge cache age `age: 133386 s` ⇒ the cached body was first stored at the edge at **2026-05-07 ~21:13 UTC**.
- Edge cache age is a *lower bound* on deployment age, not equality (the underlying deployment can be older if it was warmed at first request later). The HTML era it serves (**PR #5**) is consistent with a deployment built shortly after PR #5 merged on 2026-05-08 09:17 UTC, with the cached response stored at the edge later.

### Branch each deployment was built from

**N/A — needs Vercel access.** PR #5's description explicitly stated *"I will deploy this branch to Vercel prod via CLI once it's merged"* (https://github.com/titoortis/dripv2/pull/5), which signals an out-of-band `vercel --prod` push from the PR #5 feature branch rather than a Git-integration-driven build from `main`. This is consistent with everything else (no preview links on PRs, no checks on PRs, repo state still PR #5 era), but the truthful confirmation requires reading the deployment's `meta.githubCommitRef` from the Vercel API.

### Production alias

**N/A — needs Vercel access.** The alias `drip-silk.vercel.app` clearly resolves to *some* deployment (we got HTTP 200). What I can't tell from outside is whether (a) the alias is pointing at the latest successful deployment for the project, or (b) it's pinned to a specific older deployment id even though newer deployments exist behind it.

### Deployed-content fingerprint (the part I *can* prove)

`curl https://drip-silk.vercel.app/` returns 16,483 bytes of HTML containing:

- A nav `New · Now powered by Seedance 2.0` pill — introduced in **PR #5**.
- The hero `Your Photo. / One Cinematic Short.` headline — **PR #5**.
- A `<textarea ...placeholder="Опиши идею ролика — соберу под Seedance 2.">` with a `<button ...>Сделать промпт</button>` — the `PromptComposer` component, introduced in PR #5 commit `3f878c6` (`feat(prompt): Seedance 2 prompt-engineer agent + scroll fix on landing`).
- The `mix-blend-luminosity` `PresetDeckMock` with five hard-coded preset gradients — **PR #5**.

Locked-in negative markers (PR #15 / PR #6 strings that **must** be present if the deployment were current):

| Marker | Source | Count on prod |
|---|---|---|
| `Featured preset` | PR #15 (`<FeaturedPresetSection />`) | **0** |
| `Tap to launch` | PR #15 | **0** |
| `PresetLauncher` (component name in chunk metadata) | PR #15 | **0** |
| `Cinematic generation lands soon` | PR #6+ in `<ComingSoon />` body | **0** on `/` (does appear on `/create`) |

The `PromptComposer` placeholder (`Опиши идею ролика`) and `Сделать промпт` button were **removed** in PR #6 (commit `def00bc` on branch `devin/1778239497-pr1-tighten-mvp`, merged as `cee50c9`). They are not present anywhere on `main`:

```
$ git grep -F 'PromptComposer' main -- src/app
(no matches)
```

So the deployed HTML uniquely identifies the build tree as **PR #5 era** — it must contain code that exists on PR #5 but not on PR #6+. That makes the deployment at minimum **11 PRs and 17 commits behind `main`**.

`/create` returns HTTP 200 and renders the `<ComingSoon />` placeholder (`Drip · early access` + `Cinematic generation lands soon`), confirming `NEXT_PUBLIC_LAUNCH_MODE=marketing` is set in Vercel project env. `/api/presets` returns **HTTP 500** — but in marketing mode no client page calls it, so this does not affect the user-visible homepage today.

---

## Findings

### Exact mismatch or confirmation

**MISMATCH, with high confidence.** Production is serving a build that was produced from the **PR #5 era tree** (HEAD at or before merge commit `929dcfd` on `main`, equivalently at or before `fb8ff8f` on the PR #5 feature branch). `main` is currently at `f6936c5` (PR #16 merge), which is **17 commits / 11 merged PRs ahead** of what production is rendering. The PR #15 surface the user expects to see (the "Featured preset" interactive card + Higgs-style launcher) is **not on production**.

### Likely root cause

The strongest hypothesis given the evidence in the repo and the public production response is **(B): deployment exists for the wrong branch / out-of-band CLI deploy not refreshed**. Specifically:

- **PR #5's description** explicitly stated *"I will deploy this branch to Vercel prod via CLI once it's merged"*. That is a manual `vercel --prod` from a feature branch, not a Git-integration-driven build from `main`.
- **No PR in the repo (PRs #4 through #16) shows preview-deployment links or any Vercel/GitHub status check** (every PR reads `0 checks`). If the Vercel ↔ GitHub integration were wired to this repo and main, every merged PR would normally have an attached production-build status check and (for the PR branch itself) a preview deployment.
- **No `.vercel/` directory and no `vercel.json` in the repo.** Vercel project config is held entirely on the Vercel side. Nothing in the repo would hint at, or override, the integration state.
- **No GitHub Actions workflows** in the repo (no `.github/` directory at all). So there is also no third-party CI piping `vercel deploy` calls.
- **Cache headers are consistent** with a single old deployment serving every request: `cache-control: public, max-age=0, must-revalidate` + `x-vercel-cache: HIT` + a stable `etag`. No newer deployment has invalidated the edge cache.
- **The HTML era exactly matches PR #5** — not "almost current with one PR missing", which is what you'd expect from a transient Git-build failure or a stuck Vercel job. It looks like a deployment that has not been refreshed at all since the PR #5-era CLI push.

So the most truthful framing is: **the Vercel project for this domain is not auto-deploying from `main`. Production has been frozen at the PR #5 build since the manual deploy described in PR #5.** Possible underlying causes — none of which I can distinguish without dashboard / API access:

1. Vercel ↔ GitHub integration is not installed / not connected to this repo.
2. The integration is installed but the project's "Production Branch" is not set to `main` (or is pointed at a feature branch that is no longer active).
3. The integration is installed and connected, but auto-deploys for the production branch are paused / disabled.
4. Auto-deploys are enabled but every build since the PR #5-era deploy has failed (in which case the dashboard will show ~11 failed builds in a row).

The other categories from your task list are demonstrably *not* the cause given the public evidence:

- **(A) Vercel never received the Git event:** equivalent to the (1)/(2)/(3) variants above; cannot distinguish from outside.
- **(C) Deployment succeeded but production alias did not move:** unlikely. If a newer build had succeeded, even if the alias hadn't been promoted, the project's *latest production deployment* would normally still be at a current SHA — the user would see "stale alias" rather than "11 PRs of code missing". If the alias is pinned, the dashboard will show this and option (1)/(2)/(3) is the better next test.
- **(D) Browser / cache / DNS staleness:** ruled out. `curl` from a fresh client (no cookies, fresh User-Agent) sees the stale build directly. The `x-vercel-cache: HIT` is server-side edge cache, not client-side. A new deployment would invalidate it via a new `etag`.
- **(E) Build / env config blocking:** unlikely as the *primary* cause because the project demonstrably *did* deploy successfully once (we are reading its output). It could be the cause if every post-PR-5 build has failed, in which case the dashboard will show that pattern. Plausible failure modes if PR #6+ ever did try to build:
  - PR #6 introduces real DB writes through the wallet/job pipeline. If `DATABASE_URL` is the dummy `file:/tmp/dev.db` (the value the README documents for marketing mode) and `NEXT_PUBLIC_LAUNCH_MODE=marketing` is removed, build/runtime can break. **However**, with `NEXT_PUBLIC_LAUNCH_MODE=marketing` still set, the consumer pages should short-circuit to `<ComingSoon />` and the build should still succeed. So this is a candidate failure mode for *new* deployments only if the env var was changed.

### Confidence level

- **Production is at the PR #5 era, not at `main`:** 99% (HTML fingerprint is uniquely-identifying — `Опиши идею ролика` and `Сделать промпт` exist only in PR #5's branch tree).
- **Root cause is in the bucket "Vercel-Git auto-deploy from `main` is not running for this project / domain":** 90% based on the public-evidence chain above; the remaining 10% covers the failure-loop variant (every build since PR #5 failing) which only the Vercel dashboard can disambiguate.
- **Exact deployment SHA on Vercel:** 0% from outside — needs Vercel API or dashboard to read.

---

## Actions Taken

### What I checked

| Check | Result |
|---|---|
| `git fetch origin main && git log --oneline -n 8` | HEAD `f6936c5`, PR #16 merge. Local repo synced to remote. |
| `git log --merges --since='7 days ago'` | 14 merge commits captured (PRs #1–#16, plus initial). |
| Repo for Vercel project hints (`vercel.json`, `.vercel/`, `.vercelignore`) | None present. |
| Repo for CI workflows (`.github/workflows/`) | None present (no `.github/` directory). |
| `README.md` for the deploy section | "Deploying to Vercel" describes Phase 1 (`NEXT_PUBLIC_LAUNCH_MODE=marketing`) env vars but does **not** specify Git-integration vs CLI workflow. |
| `git grep -F 'PromptComposer' main -- src/app` | No matches. Confirms `main` does not contain the textarea/Russian button visible on prod. |
| `git show fb8ff8f5:src/components/PromptComposer.tsx` | Confirmed PR #5 branch tip contains `PromptComposer`. |
| `curl -sSI https://drip-silk.vercel.app/` | HTTP 200, `server: Vercel`, `x-vercel-cache: HIT`, `age: 133386`, `etag: "0632e13333f136797bc1d6ab4e42d201"`. |
| `curl -sS https://drip-silk.vercel.app/` (full body) | 16,483 bytes; markers from PR #5 present, markers from PR #6/#15 absent (counts table above). |
| `curl -sSI https://drip-silk.vercel.app/create` | HTTP 200, `x-vercel-cache: PRERENDER`. Body renders `<ComingSoon />` (`Drip · early access`, `Cinematic generation lands soon`). Marketing-mode env var is active. |
| `curl -sSI https://drip-silk.vercel.app/api/presets` | HTTP **500**. Not affecting user-visible pages today (homepage is on stale build that doesn't call this endpoint). |
| Inspected last 2026-05-08 commit chain | Verified the textarea was added by `3f878c6` (PR #5) and removed by PR #6 (`def00bc` → `cee50c9`). |

### Whether I redeployed

**No.** Triggering a redeploy requires either a Vercel API token or dashboard access. Neither is available in this session (`list_secrets` returned "no secrets", MCP is unreachable, and there is no `.vercel/` directory linked to a deployment for the Vercel CLI to use without project-link credentials). Per task constraints, I did not change app code to force a deploy.

### Whether cache was cleared

**No.** Cache invalidation also requires Vercel access. Note that even if I had it, clearing the edge cache would make matters worse, not better — it would re-fetch from the same stale deployment. The fix is upstream: a new deployment of `main` would invalidate this cache automatically.

### Whether production changed afterward

**No, because no fix has been applied.** Production is unchanged from the start of this investigation.

---

## Verdict

**Production is NOT in sync with `main`.**

- Latest GitHub `main` SHA: `f6936c5` (PR #16, 2026-05-09 09:48 UTC).
- Production HTML era: PR #5 (built from a tree at or before `929dcfd` / `fb8ff8f`).
- Gap: **11 merged PRs / 17 commits behind**, including the PR #15 launcher surface the user is checking for.

**No fix applied.** Manual follow-up is required. The investigation produced a high-confidence diagnosis, but the actionable fix lives in the Vercel project settings, which I cannot read or write from this session.

---

## Next Step

**One recommended next action:** open the Vercel project for `drip-silk.vercel.app` at https://vercel.com/dashboard, go to **Settings → Git** and verify that (a) the project is connected to `titoortis/dripv2`, (b) the **Production Branch** is set to `main`, and (c) auto-deploys for that branch are **enabled**. If any of those is off, fix it and click **Redeploy** on `main`. The next request to `https://drip-silk.vercel.app/` should then render the PR #15 "Featured preset" card.

If you want me to drive that fix from this session instead (read Vercel state via API, verify the integration, trigger the redeploy, and confirm production updates afterward), I need a Vercel access token — I will request one via the secrets UI on go-ahead, with the standard skip / temp / permanent options.

---

## Post-investigation update — token granted, fix applied, prod now in sync

The user granted a temporary Vercel API token. I confirmed the Vercel-side state programmatically, applied the minimum-action fix (`vercel deploy --prod` from current `main`), and re-verified production. Diagnosis was correct in shape; one detail was sharper than I could see from outside.

### Vercel-side state (programmatically verified, pre-fix)

| Field | Value |
|---|---|
| Account | `team_i7VwXEuZ74oWebSMhKu6wBFy` (`titoortis011-2009's projects`, Hobby plan) |
| Project | `prj_04xCYrqvfbls9boyJG4eAzEoNihG` (name: `drip`) |
| `link` | **`null`** — never connected to GitHub |
| `productionBranch` | **`null`** — never set |
| Total deployments | 6, **all** with `source: "cli"` (none from Git) |
| Latest production deployment | `dpl_88XLu4Fz2TvwzxjETiBn3XwJj2Tt` (URL `drip-126ep3sv4-titoortis011-2009s-projects.vercel.app`) |
| Latest production SHA | `fb8ff8f52` on branch `devin/1778182015-neuralyn-landing-prod` (= PR #5 feature-branch tip) |
| Latest production built at | **2026-05-07 20:48:56 UTC** — note this is *before* PR #5 was merged to main (2026-05-08 09:17 UTC); the deploy was a manual `vercel --prod` from the feature branch, not from main |
| Aliases pointing at it | `drip-silk.vercel.app`, `drip-titoortis011-2009-titoortis011-2009s-projects.vercel.app`, `drip-titoortis011-2009s-projects.vercel.app` |

The Vercel-API view sharpens the report's hypothesis: the project never had a Git integration. Every deployment was a feature-branch CLI push (4 from `devin/1778182015-neuralyn-landing-prod` = PR #5; 2 from `devin/1778174433-vercel-marketing-deploy` = PR #4). No deployment from `main` has ever existed.

### Side-effect note (recorded for completeness)

`vercel pull --yes` from this clean working tree auto-created a brand-new project `dripv2` (`prj_1pS52R1mzRpWaS0Cy70Hr44XmSwE`) with `link: github:titoortis/dripv2` and `productionBranch: main`. That project had **zero deployments, zero aliases, zero env vars** and would not have served `drip-silk.vercel.app`. I deleted it (`DELETE /v9/projects/prj_1pS52R1mzRpWaS0Cy70Hr44XmSwE` → `204`) and re-pointed `.vercel/project.json` at the existing `drip` project before deploying. The new-project artifact is no longer present in the team.

### Fix applied (minimum-action)

Single command, run from `main` (HEAD `f6936c52b5e892005bb04e59fb936722e1dfb917`):

```
vercel deploy --prod --yes --token=<TEMP> --scope=team_i7VwXEuZ74oWebSMhKu6wBFy
```

Build:

```
Building: Restored build cache from previous deployment (88XLu4Fz2TvwzxjETiBn3XwJj2Tt)
Building: Detected Next.js version: 14.2.15
Building: Running "pnpm run build"  (= prisma generate && next build)
Building: ✓ Compiled successfully
Building: ✓ Generating static pages (6/6)
Building: Build Completed in /vercel/output [36s]
Production: https://drip-qk5z62wyp-titoortis011-2009s-projects.vercel.app [48s]
Aliased: https://drip-silk.vercel.app [48s]
```

### Vercel-side state (post-fix)

| Field | Value |
|---|---|
| New deployment | `dpl_4PLwddVWyxod9E9NSvDtumVNVed3` (URL `drip-qk5z62wyp-titoortis011-2009s-projects.vercel.app`) |
| Inspect URL | `https://vercel.com/titoortis011-2009s-projects/drip/4PLwddVWyxod9E9NSvDtumVNVed3` |
| New production SHA | `f6936c52b` on branch `main` (= GitHub `f6936c52b5e892005bb04e59fb936722e1dfb917`, PR #16 merge) |
| Built at | **2026-05-09 10:08:42 UTC** |
| Source | `cli` (still — Git integration not added in this session; see "Long-term fix" below) |
| Aliases now pointing at it | `drip-silk.vercel.app` (and 2 others) — auto-promoted by `--prod` |

### Production HTML re-verification (post-fix)

Markers re-counted in `curl https://drip-silk.vercel.app/`:

| Marker | Source | Pre-fix | Post-fix |
|---|---|---|---|
| `Featured preset` | PR #15 (`<FeaturedPresetSection />` heading) | 0 | **1** |
| `Start with` | PR #15 (heading copy: *"Start with Iron Hero"*) | 0 | **1** |
| `Iron Hero` | already in PR #5 deck mock + new in PR #15 | 1 | **1** |
| `Now powered by Seedance` | PR #5 nav pill (still on main) | 1 | 1 |
| `Your Photo` | PR #5 hero (still on main) | 1 | 1 |
| `Сделать промпт` | PR #5 `PromptComposer` (REMOVED in PR #6) | 1 | **0** |
| `Опиши идею ролика` | PR #5 `PromptComposer` placeholder | 1 | **0** |

`/` chunk hashes flipped from `app/page-99574894dc0de368.js` (PR #5 era) to `app/page-21fb8272f3d5a532.js` (current main). `etag` flipped from `0632e13333f136797bc1d6ab4e42d201` to `6a009560e2499d0bb4861805e5a26b76`. `x-vercel-cache: HIT, age: 133386` flipped to `x-vercel-cache: PRERENDER, age: 0`. `/create` still renders `<ComingSoon />` (`Drip · early access`, `Cinematic generation lands soon`) — confirming `NEXT_PUBLIC_LAUNCH_MODE=marketing` is still active, as expected.

### Side finding still standing

`/api/presets` returns **HTTP 500** on production. Not a sync issue. Consequence on the deployed homepage: the new `<FeaturedPresetSection />` SSR-renders its heading and skeleton, but the interactive `Tap to launch` chip + the live `Iron Hero` card body never render because the client-side `useEffect(() => fetch('/api/presets'))` resolves to error. Confirmed by `Tap to launch` count = 0 in the deployed HTML (chip is inside the client-rendered card; only present when the API succeeds). Likely cause given the deployed env (`DATABASE_URL=file:/tmp/dev.db`, `STORAGE_DRIVER=local`, `STORAGE_LOCAL_DIR=/tmp/uploads`): Prisma client tries to talk to a SQLite file under `/tmp` on Vercel's ephemeral, read-only-by-default filesystem and fails. **This is a runtime problem of marketing-mode-on-Vercel + the new SSG-vs-API-route call introduced by PR #15, not part of the deploy-sync investigation.** Best long-term fix is README's **Phase 2** (Postgres + S3 + `ARK_API_KEY`); short-term fix would be making `/api/presets` short-circuit when `NEXT_PUBLIC_LAUNCH_MODE=marketing` (or making `<FeaturedPresetSection />` skip the fetch in marketing mode and use the static landing card instead). Out of scope for this PR — flagging only.

### Final verdict

**Production is now in sync with `main` at the SHA level.** `f6936c52b` on the `drip-silk.vercel.app` alias matches `f6936c5` on GitHub `main`. The PR #15 SSR surface is live; only the API-driven part of it does not render because of an unrelated runtime issue.

### Long-term fix (still pending — manual dashboard step)

This session installed a one-shot CLI deploy. It did **not** wire Git auto-deploy. Next merge to `main` will *not* automatically reach production. The simplest one-time fix:

1. Open https://vercel.com/titoortis011-2009s-projects/drip/settings/git.
2. Click **Connect Git Repository** → **GitHub** → choose `titoortis/dripv2`.
3. Set **Production Branch** to `main`. Leave **Auto Deploy** on.
4. After this is set, every merge to `main` will create a production deployment (and every PR push will create a preview deployment — which is the missing signal that's been confusing the PR review experience).

Alternatively, if the CLI-only flow is the intended workflow (consistent with how PRs #4 and #5 originally deployed), keep it as-is and run `vercel --prod` after each merge. Either is consistent; what was *not* consistent was the half-state we found at the start of this investigation.

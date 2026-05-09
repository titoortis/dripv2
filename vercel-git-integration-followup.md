# Vercel Git Integration — Follow-up

Connecting the existing Vercel project to GitHub so future merges to `main` auto-deploy and PRs receive preview deployment checks. Follow-up to the PR #17 investigation, where prod was caught manually re-synced but the underlying integration was still missing.

Constraint enforced from the brief: do not break the current production alias, do not create a second live project, no feature/UI/refactor work.

## Pre-link state (snapshot, 2026-05-09 10:18 UTC)

| Field | Value |
|---|---|
| Account | `team_i7VwXEuZ74oWebSMhKu6wBFy` (`titoortis011-2009's projects`, Hobby) |
| Project count | **1** — `drip` (`prj_04xCYrqvfbls9boyJG4eAzEoNihG`) |
| `link` | **`null`** — no Git integration |
| `productionBranch` | **`null`** — never set |
| Production alias | `drip-silk.vercel.app` → `dpl_4PLwddVWyxod9E9NSvDtumVNVed3` (from the PR #17 fix, SHA `f6936c52b` on `main`) |
| Other aliases on same deployment | `drip-titoortis011-2009-titoortis011-2009s-projects.vercel.app`, `drip-titoortis011-2009s-projects.vercel.app` |
| GitHub `main` HEAD | `13ceb83` (post-PR #17-merge) |

## Action taken — single API call, no duplicate project, no alias mutation

```http
POST https://api.vercel.com/v10/projects/prj_04xCYrqvfbls9boyJG4eAzEoNihG/link?teamId=team_i7VwXEuZ74oWebSMhKu6wBFy
Authorization: Bearer <session-only token>
Content-Type: application/json

{ "type": "github", "repo": "titoortis/dripv2" }
```

Response: HTTP `200`.

This is the lowest-impact path. It does not delete or recreate the project, does not touch aliases, does not redeploy. It only attaches a `link` object to the existing project. Vercel's GitHub App was already installed for the team (confirmed earlier in the session by `vercel pull --yes` having auto-created a now-deleted spurious project with the same Git connection), so the API call resolved against the existing GitHub credential `cred_57b9886645ff3f8c9c5fbd32c85a2a95a1896e26` and required no OAuth UI flow.

## Post-link state (verified via Vercel API)

| Required outcome | Observed value | Source |
|---|---|---|
| Project linked to **`titoortis/dripv2`** | `link.type: "github"`, `link.org: "titoortis"`, `link.repo: "dripv2"`, `link.repoId: 1230685247` | `GET /v9/projects/{id}` |
| **Production Branch = `main`** | `link.productionBranch: "main"` | same |
| **Auto-deploy enabled** | `gitProviderOptions.createDeployments: "enabled"` | same |
| **Preview deployments enabled** | `gitProviderOptions.createDeployments: "enabled"` covers both prod + preview; preview is the default; `gitComments.onPullRequest: true` adds the bot comment on every PR | same |
| Fork PR protection | `gitForkProtection: true` (default; fork PRs need explicit approval before they deploy) | same |
| Production alias **unchanged** | `drip-silk.vercel.app` → `dpl_4PLwddVWyxod9E9NSvDtumVNVed3` (same `deploymentId` as pre-link, same `createdAt: 1778174960659`) | `GET /v4/aliases` |
| **No duplicate project** created | Only `prj_04xCYrqvfbls9boyJG4eAzEoNihG` (`drip`) exists in the team | `GET /v9/projects` |

Project ID, repo, branch, auto-deploy, preview, alias preservation: all six required outcomes confirmed.

## Live validation

This very PR (`devin/1778321936-vercel-git-integration` → `main`) is the validation. Pushing the branch and opening the PR is the first GitHub event the linked project will see. Observed sequence after the push (commit `f71ed64`, 2026-05-09 10:20 UTC):

| Expected | Observed |
|---|---|
| Vercel GitHub App fires on push | ✓ — first `source: git` deployment ever recorded on this project |
| Preview deployment created (target ≠ production) | ✓ — `dpl` for SHA `f71ed6418`, ref `devin/1778321936-vercel-git-integration`, target `null` (= preview), state `READY` |
| `Vercel` status check appears on the PR | ✓ — check `Vercel`, status `success`, "Deployment has completed", inspect at https://vercel.com/titoortis011-2009s-projects/drip/4bNVsv4F2fPrXxrbVMmgLGPf1S7A |
| `Vercel Preview Comments` check appears | ✓ — status `success` |
| Vercel bot comment with Preview URL on PR | ✓ — posted by `vercel[bot]` at 2026-05-09 10:21 UTC, includes branch-aliased preview URL |
| Preview URL serves the branch's content | ✓ — `https://drip-git-devin-1778321936-ve-371864-titoortis011-2009s-projects.vercel.app/` returns HTTP 200, body contains `Featured preset` and `Iron Hero` (current main + this PR's added doc), `x-robots-tag: noindex` (correct preview behavior) |
| `drip-silk.vercel.app` alias not disturbed | ✓ — still points at `dpl_4PLwddVWyxod9E9NSvDtumVNVed3`, same `deploymentId` and `createdAt` as before the link call |
| Project count still 1 | ✓ — only `prj_04xCYrqvfbls9boyJG4eAzEoNihG` exists |

The crucial signal is the deployment record returned by `GET /v6/deployments?target=preview&projectId=…&limit=4`:

```
2026-05-09T10:20:48Z   READY   target=preview   source=git   sha=f71ed6418   ref=devin/1778321936-vercel-git-integration   url=drip-8yv85y9cp-titoortis011-2009s-projects.vercel.app
```

`source: "git"` — not `"cli"`. This is the **first** non-CLI deployment in the project's entire history (compare to the 6 prior `source: "cli"` deployments inherited from pre-link). The GitHub App webhook is the only thing that produces `source: "git"`, so this is direct evidence the integration is live, not just configured.

Production-side validation (the second half — merging to `main` triggering an auto prod deployment) cannot be performed in-session without merging this PR. It's expected to follow the same path: GitHub push to `main` → Vercel webhook → new deployment with `target: "production"` and `source: "git"` → alias auto-promotion. PR review checklist includes this step.

## Blockers

None. The single `POST .../link` call returned `200` with the expected payload. No CLI step needed, no UI step needed, no project recreation needed.

Two minor things that are *not* blockers but worth flagging:

- `link.deployHooks: []`. No deploy hooks are configured. Deploy hooks are optional and only used if you want an external service to trigger a redeploy without pushing to git (e.g. a CMS rebuild). Auto-deploys from GitHub do **not** require deploy hooks; they go through the GitHub App webhook. Mentioning this only because the field is in the response and could otherwise look like an empty configuration.
- `/api/presets` still returns HTTP 500 on production (unchanged from PR #17). This is an unrelated runtime issue (Prisma talking to `file:/tmp/dev.db` on Vercel's ephemeral filesystem) that affects the *content* of the homepage but not the *deployment* of it. Out of scope for this PR; flagged in PR #17 already.

## Final verdict

**READY.** The `drip` Vercel project is now Git-linked to `titoortis/dripv2`, production branch is `main`, auto-deploy is on for both preview (PR pushes) and production (`main` merges), and `drip-silk.vercel.app` was not disturbed. Future merges to `main` will produce a new production deployment without any human or session action.

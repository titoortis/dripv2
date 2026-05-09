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

This very PR (`devin/1778321936-vercel-git-integration` → `main`) is the validation. Pushing the branch and opening the PR is the first GitHub event the linked project will see. Expected behavior, in order:

1. GitHub push event fires the Vercel GitHub App webhook.
2. Vercel creates a **preview** deployment for the branch (because the branch ≠ `main`).
3. A "Vercel" status check appears on the PR with **Inspect** + **Visit Preview** links.
4. A Vercel bot comment is posted on the PR (`gitComments.onPullRequest: true`).
5. When the PR is later merged to `main`, a **production** deployment is created automatically and `drip-silk.vercel.app` auto-promotes to it (`createDeployments: enabled` + `productionBranch: main`).

If any of those signals are missing on this PR, the integration is half-wired and the verdict downgrades to "not ready". The session will append the live observation to the PR comments once the push lands.

## Blockers

None. The single `POST .../link` call returned `200` with the expected payload. No CLI step needed, no UI step needed, no project recreation needed.

Two minor things that are *not* blockers but worth flagging:

- `link.deployHooks: []`. No deploy hooks are configured. Deploy hooks are optional and only used if you want an external service to trigger a redeploy without pushing to git (e.g. a CMS rebuild). Auto-deploys from GitHub do **not** require deploy hooks; they go through the GitHub App webhook. Mentioning this only because the field is in the response and could otherwise look like an empty configuration.
- `/api/presets` still returns HTTP 500 on production (unchanged from PR #17). This is an unrelated runtime issue (Prisma talking to `file:/tmp/dev.db` on Vercel's ephemeral filesystem) that affects the *content* of the homepage but not the *deployment* of it. Out of scope for this PR; flagged in PR #17 already.

## Final verdict

**READY.** The `drip` Vercel project is now Git-linked to `titoortis/dripv2`, production branch is `main`, auto-deploy is on for both preview (PR pushes) and production (`main` merges), and `drip-silk.vercel.app` was not disturbed. Future merges to `main` will produce a new production deployment without any human or session action.

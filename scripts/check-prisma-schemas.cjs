#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * scripts/check-prisma-schemas.cjs
 *
 * Asserts that `prisma/schema.prisma` (the canonical / Postgres / Vercel
 * production schema) and `prisma/schema.dev.prisma` (the local SQLite mirror
 * used by `pnpm dev`) are byte-identical outside of two regions that are
 * allowed to differ:
 *
 *   1. The file-level comment header — every line before the first
 *      `generator client {` line. Each file has its own explanatory header.
 *   2. The `datasource db { ... }` block. The canonical file uses
 *      `provider = "postgresql"`; the dev mirror uses `provider = "sqlite"`.
 *      Both should point `url` at `env("DATABASE_URL")`.
 *
 * Anything else differing — fields, models, indices, generator, comments
 * inside models — is a schema drift and a build failure. The goal is to keep
 * the two files cheap to reason about: prod is what's in `schema.prisma`,
 * dev runs against the same models, the only knob is the provider line.
 *
 * Wired into `pnpm build` so any commit that lands in `main` is guaranteed
 * to keep the mirror honest. Run manually with:
 *
 *     node scripts/check-prisma-schemas.cjs
 *
 * Exit code 0 on parity, 1 on drift (prints a unified-ish diff for triage).
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CANONICAL = path.join(ROOT, "prisma", "schema.prisma");
const DEV_MIRROR = path.join(ROOT, "prisma", "schema.dev.prisma");

/**
 * Strip the parts of a schema file that are *intentionally* allowed to
 * differ between the canonical and the dev mirror:
 *   - the file-level header comment (every line before `generator client {`)
 *   - the entire `datasource db { ... }` block, including the opening and
 *     closing braces and any blank line that follows immediately.
 */
function normalize(src) {
  const lines = src.split("\n");
  let i = 0;

  // 1) Drop everything before the first `generator client {`.
  while (i < lines.length && !/^generator client \{/.test(lines[i])) {
    i += 1;
  }
  if (i === lines.length) {
    throw new Error(
      "schema file does not contain a `generator client { ... }` block",
    );
  }
  const out = [];

  // 2) Walk the remaining lines, omitting the `datasource db { ... }` block.
  let inDatasource = false;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (!inDatasource && /^datasource db \{/.test(line)) {
      inDatasource = true;
      continue;
    }
    if (inDatasource) {
      if (/^\}/.test(line)) {
        inDatasource = false;
        // Also swallow at most one trailing blank line after the closing
        // brace, so files that put a blank line after `datasource db {}` and
        // files that don't are treated identically.
        if (i + 1 < lines.length && lines[i + 1].trim() === "") {
          i += 1;
        }
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function unifiedDiff(a, b, labelA, labelB) {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const max = Math.max(aLines.length, bLines.length);
  const out = [`--- ${labelA}`, `+++ ${labelB}`];
  for (let i = 0; i < max; i += 1) {
    const av = aLines[i];
    const bv = bLines[i];
    if (av === bv) continue;
    out.push(`@@ line ${i + 1} @@`);
    if (av !== undefined) out.push(`- ${av}`);
    if (bv !== undefined) out.push(`+ ${bv}`);
  }
  return out.join("\n");
}

function main() {
  const canonical = fs.readFileSync(CANONICAL, "utf8");
  const devMirror = fs.readFileSync(DEV_MIRROR, "utf8");

  // Sanity: the canonical file must declare postgresql and the mirror sqlite.
  const canonicalDsRe = /datasource db \{\s*provider\s*=\s*"postgresql"/;
  const devMirrorDsRe = /datasource db \{\s*provider\s*=\s*"sqlite"/;
  if (!canonicalDsRe.test(canonical)) {
    console.error(
      "[check-prisma-schemas] FAIL: prisma/schema.prisma is no longer the\n" +
        "  Postgres-targeted canonical schema. Its `datasource db` block must\n" +
        "  set `provider = \"postgresql\"`. If you genuinely meant to flip the\n" +
        "  prod provider, you also need to update this check.",
    );
    process.exit(1);
  }
  if (!devMirrorDsRe.test(devMirror)) {
    console.error(
      "[check-prisma-schemas] FAIL: prisma/schema.dev.prisma is no longer the\n" +
        "  SQLite local-dev mirror. Its `datasource db` block must set\n" +
        '  `provider = "sqlite"`.',
    );
    process.exit(1);
  }

  const normCanonical = normalize(canonical);
  const normDevMirror = normalize(devMirror);

  if (normCanonical === normDevMirror) {
    return;
  }

  console.error(
    "[check-prisma-schemas] FAIL: prisma/schema.prisma and\n" +
      "  prisma/schema.dev.prisma have drifted outside of the allowed regions\n" +
      "  (file-level header comment + `datasource db { ... }` block).\n\n" +
      "  Every model change must land in prisma/schema.prisma first, then be\n" +
      "  mirrored into prisma/schema.dev.prisma byte-for-byte (apart from\n" +
      "  the datasource block).\n\n" +
      "  Diff:\n",
  );
  console.error(
    unifiedDiff(
      normCanonical,
      normDevMirror,
      "prisma/schema.prisma (normalized)",
      "prisma/schema.dev.prisma (normalized)",
    ),
  );
  process.exit(1);
}

main();

#!/usr/bin/env node
/**
 * `pnpm env:verify` — does this environment have the variables its apps will
 * refuse to boot without?
 *
 * WHY IT EXISTS. Production runs `NEXT_PUBLIC_LAUNCH_MODE=coming_soon`, which
 * EXEMPTS apps/web from most of its boot gates. Flipping to `live` arms them
 * all in one redeploy, so launch day would otherwise be the first time several
 * of them ever fired — and a gate that fires is a deploy that does not serve.
 * This answers the same question the boot does, before deploying, without
 * deploying.
 *
 * IT READS NAMES, NEVER VALUES. The manifest holds names and reasons; the
 * inputs are checked for presence and non-emptiness. Nothing is printed but a
 * variable name and why it matters, so the output is safe to paste anywhere.
 *
 * INPUTS — pick one:
 *
 *   pnpm env:verify --file apps/web/.env.local        a dotenv-style file
 *   vercel env ls production | pnpm env:verify --stdin
 *   pnpm env:verify                                    the current process env
 *
 * FLAGS:
 *   --app web|admin|agent|all   default: all
 *   --live                      treat NEXT_PUBLIC_LAUNCH_MODE as live
 *   --push                      treat push as enabled
 *   --strict                    fail on `recommended` too, not just required
 *
 * Live and push are FLAGS, never inferred: this reads names, not values, so it
 * cannot know what NEXT_PUBLIC_LAUNCH_MODE holds. The default is coming_soon,
 * which is what production runs today.
 *
 * Exit code 1 when anything REQUIRED is missing or anything FORBIDDEN is
 * present, so it is usable as a gate. `recommended` is reported and does not
 * fail unless --strict.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(HERE, "env-manifest.json"), "utf8"),
);

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const appArg = value("app") ?? "all";
const apps =
  appArg === "all" ? Object.keys(MANIFEST.apps) : appArg.split(",").map((a) => a.trim());

for (const app of apps) {
  if (!MANIFEST.apps[app]) {
    console.error(
      `Unknown app "${app}". Known: ${Object.keys(MANIFEST.apps).join(", ")}`,
    );
    process.exit(2);
  }
}

/* ------------------------------------------------------------------ */
/* Where the names come from                                           */
/* ------------------------------------------------------------------ */

/**
 * A dotenv-ish file: `KEY=value`, `export KEY=value`, `KEY=`.
 *
 * A key with an EMPTY value counts as absent, because that is exactly how
 * `.env.example` ships and how a half-filled Vercel row behaves.
 */
function readEnvFile(file) {
  const found = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const text = line.trim();
    if (text.length === 0 || text.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(text);
    if (!match) continue;
    const raw = match[2].trim().replace(/^["']|["']$/g, "");
    found.set(match[1], raw.length > 0);
  }
  return found;
}

/**
 * `vercel env ls` output, which is a table — name in the first column.
 *
 * Vercel never prints values, which is the point: this tells you a row EXISTS
 * for that scope. Whether it holds the right value is a question only the
 * deploy can answer.
 */
function readVercelTable(text) {
  const found = new Map();
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Z][A-Z0-9_]{2,})\s{2,}/.exec(line);
    if (match) found.set(match[1], true);
  }
  return found;
}

let source;
let present;
const file = value("file");
if (file) {
  source = `file ${file}`;
  present = readEnvFile(file);
} else if (flag("stdin")) {
  source = "stdin (vercel env ls)";
  present = readVercelTable(fs.readFileSync(0, "utf8"));
} else {
  source = "the current process environment";
  present = new Map(
    Object.entries(process.env).map(([k, v]) => [
      k,
      typeof v === "string" && v.length > 0,
    ]),
  );
}

const has = (name) => present.get(name) === true;

/* ------------------------------------------------------------------ */
/* What applies                                                        */
/* ------------------------------------------------------------------ */

/*
 * Live and push are FLAGS, not inferences, and that is deliberate: this tool
 * reads names and never values, so it cannot know what
 * NEXT_PUBLIC_LAUNCH_MODE is set to. The default is `coming_soon`, which is
 * production's posture today; `--live` is how you rehearse the flip that arms
 * several gates at once.
 */
const live = flag("live");
const push = flag("push");

const strict = flag("strict");

console.log(`env:verify — reading names from ${source}`);
console.log(
  `mode: ${live ? "LIVE (launch-mode gates armed)" : "coming_soon (launch-mode gates waived — pass --live to rehearse the flip)"}, push ${
    push ? "ON" : "OFF"
  }\n`,
);

let failures = 0;
let warnings = 0;

for (const app of apps) {
  const spec = MANIFEST.apps[app];
  const required = [
    ...spec.always,
    ...(live ? spec.whenLive : []),
    ...(push ? spec.whenPush : []),
  ];

  const missing = required.filter((entry) => !has(entry.name));
  const forbidden = (spec.forbidden ?? []).filter((entry) => has(entry.name));
  const absentRecommended = spec.recommended.filter((entry) => !has(entry.name));

  const waived = live ? [] : spec.whenLive.filter((entry) => !has(entry.name));

  if (missing.length === 0 && forbidden.length === 0) {
    console.log(`✓ apps/${app}: ${required.length} required variables present`);
  } else {
    console.log(`✗ apps/${app}`);
  }

  for (const entry of missing) {
    failures += 1;
    console.log(`   MISSING  ${entry.name}`);
    console.log(`            ${entry.why}`);
  }
  for (const entry of forbidden) {
    failures += 1;
    console.log(`   FORBIDDEN ${entry.name} — remove it from this app's scope`);
    console.log(`            ${entry.why}`);
  }
  for (const entry of absentRecommended) {
    warnings += 1;
    console.log(`   absent   ${entry.name}`);
    console.log(`            ${entry.why}`);
  }
  if (waived.length > 0) {
    console.log(
      `   note     ${waived.length} launch-mode variable(s) not set and not checked, because this environment is coming_soon.`,
    );
    console.log(
      `            Re-run with --live before flipping NEXT_PUBLIC_LAUNCH_MODE — that flip arms them all in one deploy.`,
    );
  }
  console.log("");
}

if (failures > 0) {
  console.error(
    `${failures} problem(s) that would refuse a boot or breach an app boundary.`,
  );
  process.exit(1);
}
if (strict && warnings > 0) {
  console.error(`${warnings} recommended variable(s) absent, and --strict was passed.`);
  process.exit(1);
}
console.log(
  warnings > 0
    ? `No boot-blocking problems. ${warnings} recommended variable(s) absent — each one is something quietly worse.`
    : "Everything the manifest names is present.",
);

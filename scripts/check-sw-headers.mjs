#!/usr/bin/env node
/**
 * Asserts that every app still serves `/sw.js` with the two headers web push
 * depends on, AFTER `withSentryConfig` has composed its own configuration on
 * top of ours.
 *
 * WHY THIS EXISTS. Tier 5 wrapped all three `next.config.mjs` files in
 * `withSentryConfig`. The `headers()` rule those files carry is the only
 * reason push works at all: a `/sw.js` served from cache means the browser
 * keeps running the OLD worker, so every change appears to do nothing and
 * NOTHING anywhere reports that a stale version is in play; and without
 * `Service-Worker-Allowed: /` the worker cannot claim the root scope, so it is
 * never woken for anything but `/` itself.
 *
 * Both failures are silent. Typecheck cannot see them, no test exercises the
 * Next config, and the only existing check is a human running the hosted smoke
 * test in `docs/features/f3-hosted-setup.md`. This runs in a second.
 *
 *   node scripts/check-sw-headers.mjs
 */

import { pathToFileURL } from "node:url";
import path from "node:path";

const APPS = ["web", "admin", "agent"];
const REQUIRED = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "Service-Worker-Allowed": "/",
};

let failed = false;

const repoRoot = process.cwd();

for (const app of APPS) {
  const appDir = path.resolve(repoRoot, "apps", app);
  // `withSentryConfig` resolves the installed `next` relative to the working
  // directory; from the repo root it cannot find it and warns on every run.
  process.chdir(appDir);
  const configPath = path.join(appDir, "next.config.mjs");
  const { default: config } = await import(pathToFileURL(configPath).href);
  process.chdir(repoRoot);

  if (typeof config?.headers !== "function") {
    console.error(`✗ apps/${app}: the composed config has no headers() at all.`);
    failed = true;
    continue;
  }

  const rules = await config.headers();
  const rule = rules.find((r) => r.source === "/sw.js");
  if (!rule) {
    console.error(`✗ apps/${app}: no header rule for /sw.js survived the wrap.`);
    failed = true;
    continue;
  }

  const got = Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));
  const missing = Object.entries(REQUIRED).filter(([key, value]) => got[key] !== value);
  if (missing.length > 0) {
    for (const [key, value] of missing) {
      console.error(
        `✗ apps/${app}: /sw.js ${key} is ${JSON.stringify(got[key] ?? null)}, want ${JSON.stringify(value)}.`,
      );
    }
    failed = true;
    continue;
  }

  console.log(`✓ apps/${app}: /sw.js keeps no-cache + Service-Worker-Allowed`);
}

if (failed) {
  console.error(
    "\nWeb push depends on these headers and BOTH failure modes are silent.\n" +
      "Look at what the next.config wrap composed before changing this check.",
  );
  process.exit(1);
}

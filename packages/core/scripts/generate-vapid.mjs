/**
 * VAPID keypair generator + distributor.  `pnpm push:vapid`
 *
 * VAPID (Voluntary Application Server Identification) is how a push service —
 * Google's FCM for Chrome, Mozilla's autopush for Firefox, Apple's APNs for
 * Safari — knows a push request actually came from Koolee. The pair is
 * generated ONCE per environment: the public key goes to the browser at
 * subscribe time, and every outgoing push is signed with the private key.
 *
 * IT WRITES TO ALL THREE APPS, and that is a correction, not a convenience.
 * The first version wrote only to `apps/web`, and the result was a real bug:
 * the agent and admin apps could register subscriptions (they only need the
 * public key for that) but had no private key to SIGN with, so their runtime
 * fell back to `ConsolePushSender` — which logs a line and reports SUCCESS.
 * Their "send me a test notification" button asked "did you see it?" about a
 * notification that had never left the process. **Every app that sends needs
 * the private key**, and each of the three sends at least its own self-test.
 *
 * IDEMPOTENT. It never regenerates: if a private key already exists anywhere,
 * that pair is reused and simply distributed to whichever apps are missing
 * it. Re-running is always safe.
 *
 * Writes to each app's `.env.local`, which is gitignored. Hosted environments
 * set the same values in their own dashboard — see
 * docs/features/f3-hosted-setup.md.
 */
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import webpush from "web-push";

// packages/core/scripts → repo root. The script lives beside the `web-push`
// dependency (in core), and writes into every app.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const APPS = ["web", "agent", "admin"];
const envPathFor = (app) => path.join(repoRoot, "apps", app, ".env.local");

const read = (file) => (existsSync(file) ? readFileSync(file, "utf8") : "");
const valueOf = (contents, key) => {
  const match = contents.match(new RegExp(`^\\s*${key}=(.+)$`, "m"));
  return match ? match[1].trim() : null;
};

/* ---- find an existing pair before making a new one ---------------------- */

let keys = null;
let source = null;
for (const app of APPS) {
  const contents = read(envPathFor(app));
  const privateKey = valueOf(contents, "VAPID_PRIVATE_KEY");
  const publicKey = valueOf(contents, "VAPID_PUBLIC_KEY");
  if (privateKey && publicKey) {
    keys = {
      publicKey,
      privateKey,
      subject: valueOf(contents, "VAPID_SUBJECT") ?? "mailto:ops@koolee.cloud",
    };
    source = app;
    break;
  }
}

if (keys) {
  console.log(`Reusing the existing VAPID pair from apps/${source}/.env.local.`);
  console.log("  (Never regenerated automatically — see the note at the end.)");
} else {
  const generated = webpush.generateVAPIDKeys();
  keys = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: process.env.VAPID_SUBJECT || "mailto:ops@koolee.cloud",
  };
  console.log("Generated a new VAPID pair.");
}

/* ---- distribute to every app that is missing it ------------------------ */

const block = [
  "",
  "# --- Web Push (VAPID) — written by `pnpm push:vapid`. Do not commit. ---",
  "# Regenerating invalidates every stored subscription. See the script header.",
  "# All four are needed in EVERY app: without the private key a send silently",
  "# falls back to console logging and reports success.",
  `VAPID_PUBLIC_KEY=${keys.publicKey}`,
  `VAPID_PRIVATE_KEY=${keys.privateKey}`,
  `VAPID_SUBJECT=${keys.subject}`,
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`,
  "",
].join("\n");

const REQUIRED = [
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
];

for (const app of APPS) {
  const file = envPathFor(app);
  const contents = read(file);
  const missing = REQUIRED.filter((key) => !valueOf(contents, key));

  if (missing.length === 0) {
    console.log(`  apps/${app}      already complete — left alone`);
    continue;
  }

  if (missing.length < REQUIRED.length) {
    // Half-configured is the state that caused the bug, and quietly appending
    // a second copy of some keys would make the file ambiguous. Say so.
    console.log(
      `  apps/${app}      PARTIAL (missing ${missing.join(", ")}) — appending the full block;` +
        " remove the older duplicate lines by hand",
    );
  } else {
    console.log(`  apps/${app}      written`);
  }

  // Append rather than write: .env.local holds each app's other credentials,
  // and clobbering them to add four lines would be a rude script.
  if (contents) appendFileSync(file, block, "utf8");
  else writeFileSync(file, block.replace(/^\n/, ""), "utf8");
}

console.log("");
console.log(`  public key : ${keys.publicKey}`);
console.log(`  subject    : ${keys.subject}`);
console.log("");
console.log("Restart the dev servers to pick them up.");
console.log("");
console.log("KEEP THESE. Regenerating invalidates every stored subscription —");
console.log("every device goes silent while still reporting 'subscribed'. To rotate");
console.log("deliberately: delete the VAPID_ lines from all three .env.local files,");
console.log("re-run this, then TRUNCATE push_subscriptions.");

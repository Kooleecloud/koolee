import { z } from "zod";

/**
 * Environment access for apps/web.
 *
 * Contract (see root README):
 *  - Importing this module NEVER throws. The app must boot with zero real
 *    credentials so `pnpm build` works on a fresh clone.
 *  - Every var is optional at parse time. A var becomes required only when a
 *    code path that genuinely needs it executes — call `requireEnv()` there.
 *  - Malformed values degrade to `undefined` with a dev warning rather than
 *    crashing the process.
 *  - TWO exceptions, both server-side boot checks below: OTP_LOG_HMAC_KEY is
 *    validated at import whenever DATABASE_URL is set, and a production boot
 *    with Supabase configured must pass `assertProductionSecurityConfig`.
 *
 * NEXT_PUBLIC_* vars are referenced as literal `process.env.X` member
 * expressions so the Next compiler can inline them into the client bundle.
 */

const optionalString = z.string().min(1).optional().catch(undefined);
const optionalUrl = z.url().optional().catch(undefined);

/**
 * The Supabase **API** URL, and specifically not the database host.
 *
 * `https://db.<ref>.supabase.co` is the direct Postgres host: IPv6-only, and
 * it serves no HTTP API at all. Pasted into this variable — an easy mistake,
 * because it is the hostname the Database settings page shows — every auth
 * call fails with `ERR_NAME_NOT_RESOLVED`, supabase-js reports it as an auth
 * error, and the staff apps render it as "Email or password didn't match"
 * over credentials that are perfectly correct. It cost a day (2026-08-30).
 *
 * Rejecting it here turns that into the app's honest "not configured" state,
 * which the boot warnings and the env panel both name. The right value comes
 * from Settings → **API** → Project URL: `https://<ref>.supabase.co`.
 */
const supabaseApiUrl = z
  .url()
  .refine((value) => !/^https?:\/\/db\./i.test(value), {
    message:
      "NEXT_PUBLIC_SUPABASE_URL is the db.<ref> host (direct Postgres, IPv6-only, no HTTP API). " +
      "Use Settings → API → Project URL: https://<ref>.supabase.co",
  })
  .optional()
  .catch(undefined);

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development")
    .catch("development"),

  // --- App ---------------------------------------------------------------
  /** Absolute origin of this app. Used to build absolute links and callbacks. */
  NEXT_PUBLIC_APP_URL: optionalUrl,
  /**
   * "coming_soon" ships the marketing site and a browsable booking funnel
   * with every account surface closed: /login, /trips and /dashboard bounce
   * home, the funnel's verify step renders a coming-soon panel, and the OTP
   * server actions refuse to send. Anything else (or unset) means live.
   */
  NEXT_PUBLIC_LAUNCH_MODE: z.enum(["live", "coming_soon"]).default("live").catch("live"),

  // --- Database (Supabase Postgres) -------------------------------------
  /** Supavisor transaction-mode pooler, port 6543. Runtime queries. */
  DATABASE_URL: optionalString,
  // DIRECT_DATABASE_URL is deliberately NOT read here: it is a hosted DDL
  // credential and belongs in packages/db/.env alone (see .env.example).

  // --- Supabase (auth, Realtime, Storage) --------------------------------
  NEXT_PUBLIC_SUPABASE_URL: supabaseApiUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  /**
   * Declares whether DATABASE_URL points at a database with GoTrue's `auth`
   * schema. "false" (bare local Postgres) skips claim reconciliation on
   * upgrade sends — an explicit signal, not the 42P01 error-code sniffing it
   * replaced. Unset counts as available: a genuinely missing schema then
   * fails the send loudly instead of silently disabling reconciliation.
   */
  AUTH_SCHEMA_AVAILABLE: z.enum(["true", "false"]).optional().catch(undefined),

  // --- Bot protection (Cloudflare Turnstile) ------------------------------
  // Site key only. The SECRET key lives in the Supabase dashboard (Auth →
  // Attack Protection): Supabase verifies the captchaToken we forward on
  // auth calls, so this app never calls siteverify.
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalString,

  // --- OTP send-log hashing ------------------------------------------------
  // Server-side only. HMAC key for otp_send_log.destination_hash; the OTP
  // throttle persists hashes, never plaintext phones/emails. Required (min
  // 32 chars) whenever DATABASE_URL is set — enforced at boot below.
  OTP_LOG_HMAC_KEY: optionalString,

  // --- Scheduled jobs ------------------------------------------------------
  /** Shared secret for manually-invoked job routes (/api/jobs/*). */
  CRON_SECRET: optionalString,

  // --- Payments ----------------------------------------------------------
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalString,

  // --- Background jobs ---------------------------------------------------
  INNGEST_EVENT_KEY: optionalString,
  INNGEST_SIGNING_KEY: optionalString,

  // --- Notifications -----------------------------------------------------
  // Auth OTP delivery is owned by Supabase Auth; its SMS provider credentials
  // live ONLY in the Supabase dashboard, never here. Custody-event SMS
  // credentials land with the notifications work item (NotificationDispatcher
  // in @koolee/core is the seam).
  RESEND_API_KEY: optionalString,
  /**
   * Ops inbox for `booking/exception_raised` alert emails. Optional at parse
   * time (dev sends nowhere), but REQUIRED by the production boot gate below —
   * unset in prod means every alert is silently skipped.
   */
  OPS_ALERT_EMAIL: optionalString,
  /**
   * How many hours before a pickup window an agent is assigned to it.
   *
   * A booking bought months ahead used to get an agent the moment the card
   * cleared. Beyond this horizon a paid booking rests with no verification
   * task and no pickup task; the five-minute assignment-horizon sweep picks it up
   * when its window comes into range. Unset or unparseable → the core default
   * (48). A number, not a policy: changing it is a config change only.
   */
  ASSIGNMENT_HORIZON_HOURS: optionalString,
  /**
   * RFC 5322 From for transactional email. The default is Resend's sandbox
   * sender — fine for dev/testing, but real deliveries need a verified
   * domain: set RESEND_FROM to e.g. `Koolee <notify@koolee.com>` once the
   * domain's DKIM/SPF records are in place (see the manual-setup doc).
   */
  RESEND_FROM: z.string().default("Koolee <onboarding@resend.dev>"),

  /**
   * Absolute origins of the two STAFF apps.
   *
   * Used for ONE thing: the deep link on a push sent to an agent, a driver or
   * ops. The Inngest functions run in this app, so this is where those links
   * have to be built. Absent → the push still goes, without a link.
   */
  NEXT_PUBLIC_AGENT_APP_URL: optionalUrl,
  NEXT_PUBLIC_ADMIN_APP_URL: optionalUrl,

  // --- Web Push (VAPID) --------------------------------------------------
  /**
   * THE PUSH KILL SWITCH. `"true"` to enable; anything else (including unset)
   * means OFF, in every environment.
   *
   * Push ships DISABLED. It is the one channel that fails silently and
   * undetectably, so it is opt-in by explicit configuration rather than
   * something you get by accident when a key happens to be present.
   *
   * ONE VARIABLE, NOT TWO. It is `NEXT_PUBLIC_` so the server and the browser
   * read the SAME value — same pattern as NEXT_PUBLIC_LAUNCH_MODE. A
   * server flag paired with a public twin is two things that can disagree,
   * and this slice has already paid once for exactly that shape (the agent
   * app held the public VAPID key but not the private one, so it registered
   * devices and silently sent nothing). "Is push on" is not a secret.
   *
   * OFF means: `ConsolePushSender` regardless of the VAPID vars, every enable
   * affordance hidden, and the VAPID boot gate waived. Stored subscriptions
   * are left ALONE — flipping it back on resumes sends with no re-subscribe.
   */
  NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .catch("false"),
  /**
   * VAPID keypair identifying Koolee to every push service (FCM for Chrome,
   * Mozilla autopush, APNs for Safari). Generate ONCE with `pnpm push:vapid`.
   *
   * REGENERATING INVALIDATES EVERY STORED SUBSCRIPTION — every device silently
   * stops receiving notifications while its UI still says "subscribed", and
   * everyone has to re-enable by hand. The keygen script refuses to overwrite
   * an existing pair for exactly that reason.
   *
   * The public key is ALSO exposed as NEXT_PUBLIC_VAPID_PUBLIC_KEY, because
   * the browser needs it at `pushManager.subscribe` time. It is a public key;
   * shipping it to the client is the design, not a leak.
   */
  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalString,
  /** `mailto:` or `https:`. Apple REFUSES a push whose subject is neither. */
  VAPID_SUBJECT: optionalString,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: optionalString,

  // --- Third-party data --------------------------------------------------
  AEROAPI_KEY: optionalString,
  /**
   * SERVER key for Google Maps Platform — Routes API (drive-time ETAs) and
   * Places API (New) (the address step's autocomplete proxy).
   *
   * Renamed from `GOOGLE_MAPS_API_KEY`, which was parsed and never read by
   * anything, because the name now carries a rule: this key is only ever used
   * server-side, it must be restricted to those two APIs, and its application
   * restriction must be "server" (IP or none) — NEVER an HTTP referrer, which
   * would mean shipping it to a browser. Absent ⇒ haversine ETAs and a plain
   * typed address field, which is what a fresh clone runs.
   */
  GOOGLE_MAPS_SERVER_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  /**
   * Set to "1" to return the RAW ticket-extraction diagnostics to the browser
   * — every segment the model read, which leg was chosen and why, both model
   * attempts with their token usage.
   *
   * Off unless explicitly set, and it must NEVER be set on the production
   * project: the payload contains the customer's full itinerary and is meant
   * for a developer looking at their own upload. It is deliberately gated on
   * this flag alone rather than on NODE_ENV, so it can be switched on for a
   * preview deployment (which builds as production) while debugging a ticket.
   */
  TICKET_EXTRACTION_DEBUG: optionalString,

  // --- Observability -----------------------------------------------------
  /**
   * Sentry's DSN, and deliberately `NEXT_PUBLIC_`.
   *
   * ONE variable for both runtimes, for the same reason the push kill switch
   * is one: a server-only `SENTRY_DSN` plus a public twin is two things that
   * can disagree, and the failure — the browser half silently reporting
   * nothing while the server half looks healthy — is invisible. A DSN is not a
   * secret; it is in every client bundle by design, and it grants nothing but
   * the ability to send events to one project.
   *
   * Absent ⇒ the SDK initialises with no DSN and drops everything, which is
   * what a fresh clone and every local run do.
   */
  NEXT_PUBLIC_SENTRY_DSN: optionalString,
  /**
   * Source-map upload, BUILD TIME ONLY — never read at runtime. All three
   * absent (a laptop build) means the upload step is skipped silently and
   * stack traces in Sentry stay minified.
   */
  SENTRY_ORG: optionalString,
  SENTRY_PROJECT: optionalString,
  SENTRY_AUTH_TOKEN: optionalString,
});

export type Env = z.infer<typeof schema>;
export type EnvKey = keyof Env;

/**
 * Explicit member expressions: required for NEXT_PUBLIC_* inlining, and it
 * keeps the set of vars this app reads greppable.
 */
const raw = {
  NODE_ENV: process.env.NODE_ENV,

  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_LAUNCH_MODE: process.env.NEXT_PUBLIC_LAUNCH_MODE,

  DATABASE_URL: process.env.DATABASE_URL,

  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  AUTH_SCHEMA_AVAILABLE: process.env.AUTH_SCHEMA_AVAILABLE,

  NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,

  OTP_LOG_HMAC_KEY: process.env.OTP_LOG_HMAC_KEY,

  CRON_SECRET: process.env.CRON_SECRET,

  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,

  INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
  INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,

  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM: process.env.RESEND_FROM,
  OPS_ALERT_EMAIL: process.env.OPS_ALERT_EMAIL,
  ASSIGNMENT_HORIZON_HOURS: process.env.ASSIGNMENT_HORIZON_HOURS,

  NEXT_PUBLIC_AGENT_APP_URL: process.env.NEXT_PUBLIC_AGENT_APP_URL,
  NEXT_PUBLIC_ADMIN_APP_URL: process.env.NEXT_PUBLIC_ADMIN_APP_URL,
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED:
    process.env.NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED,

  AEROAPI_KEY: process.env.AEROAPI_KEY,
  GOOGLE_MAPS_SERVER_KEY: process.env.GOOGLE_MAPS_SERVER_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  TICKET_EXTRACTION_DEBUG: process.env.TICKET_EXTRACTION_DEBUG,

  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  SENTRY_ORG: process.env.SENTRY_ORG,
  SENTRY_PROJECT: process.env.SENTRY_PROJECT,
  SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
};

/** `.catch()` on every field guarantees this resolves without throwing. */
export const env: Env = schema.parse(raw);

/** Thrown when a code path needs a credential that was never configured. */
export class MissingEnvError extends Error {
  readonly key: EnvKey;

  constructor(key: EnvKey, hint: string) {
    super(`Missing required environment variable ${key}. ${hint}`);
    this.name = "MissingEnvError";
    this.key = key;
  }
}

const HINTS: Partial<Record<EnvKey, string>> = {
  DATABASE_URL:
    "Supabase → Project Settings → Database → Connection pooling (Transaction mode, port 6543).",
  STRIPE_SECRET_KEY: "Stripe Dashboard → Developers → API keys.",
  STRIPE_WEBHOOK_SECRET:
    "Stripe Dashboard → Developers → Webhooks, or `stripe listen` for local dev.",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "Stripe Dashboard → Developers → API keys.",
  NEXT_PUBLIC_SUPABASE_URL: "Supabase → Project Settings → API → Project URL.",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "Supabase → Project Settings → API → anon public key.",
  SUPABASE_SERVICE_ROLE_KEY:
    "Supabase → Project Settings → API → service_role key. Server-side only.",
  AUTH_SCHEMA_AVAILABLE:
    'Set "false" only when DATABASE_URL is a bare Postgres with no GoTrue ' +
    "auth schema (local docker). Leave unset against any Supabase project.",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY:
    "Cloudflare Dashboard → Turnstile → your site → Site key (invisible mode). " +
    "The secret key goes in the Supabase dashboard, not in app env.",
  OTP_LOG_HMAC_KEY:
    "Generate with `openssl rand -hex 32` (min 32 chars). Rotating it resets " +
    "OTP rate-limit windows, which is harmless.",
  CRON_SECRET: "Any random string; protects /api/jobs/* manual triggers.",
  INNGEST_EVENT_KEY:
    "Inngest Cloud → Events → Event keys. Not needed for `pnpm dev:inngest`.",
  INNGEST_SIGNING_KEY: "Inngest Cloud → Deploy → Signing key.",
  AEROAPI_KEY: "FlightAware AeroAPI. Stubbed in this scaffold.",
  GOOGLE_MAPS_SERVER_KEY:
    "Google Cloud Console → Maps Platform. Restrict to Routes API + Places API (New), application restriction = server, never an HTTP referrer.",
  NEXT_PUBLIC_SENTRY_DSN:
    "Sentry → Project → Settings → Client Keys (DSN). Public by design; one per app, per environment.",
  SENTRY_ORG: "Sentry → Settings → Organization slug. Build time only.",
  SENTRY_PROJECT: "Sentry → Project → Settings → Name (slug). Build time only.",
  SENTRY_AUTH_TOKEN:
    "Sentry → Settings → Auth Tokens, scope `project:releases`. Build time only; uploads source maps.",
};

/** Reads a var, throwing a descriptive error if it is absent. */
export function requireEnv(key: EnvKey): string {
  const value = env[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new MissingEnvError(key, HINTS[key] ?? "See .env.example.");
  }
  return value;
}

/** Non-throwing read. */
export function optionalEnv(key: EnvKey): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/*
 * The one exception to the never-throw contract: with a database configured
 * the OTP throttle WILL write `destination_hash` rows, so a missing or short
 * OTP_LOG_HMAC_KEY must fail HERE at env validation — not at the first OTP
 * send. A fresh clone with no DATABASE_URL still boots green: without a
 * database the throttle never runs and the key is never read.
 * `typeof window` guard: the server bundle is where the key matters; client
 * bundles never see server-side vars and must not throw over their absence.
 */
if (typeof window === "undefined" && env.DATABASE_URL) {
  const key = env.OTP_LOG_HMAC_KEY;
  if (!key || key.length < 32) {
    throw new MissingEnvError("OTP_LOG_HMAC_KEY", HINTS.OTP_LOG_HMAC_KEY!);
  }
}

export const isDev = env.NODE_ENV === "development";
export const isProd = env.NODE_ENV === "production";

/**
 * Pre-launch posture (NEXT_PUBLIC_LAUNCH_MODE=coming_soon): account creation
 * and sign-in are closed everywhere. A function, not a const, so tests can
 * mock it per-case.
 */
export function isComingSoon(): boolean {
  return env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon";
}

/**
 * The push kill switch. Default OFF — see the schema entry.
 *
 * Read by the runtime (which sender to build), the boot gate (whether VAPID
 * is required) and the client surfaces (whether to offer enabling at all), so
 * all three can never disagree about whether push is on.
 */
export function pushNotificationsEnabled(): boolean {
  return env.NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED === "true";
}

/**
 * Whether the database carries GoTrue's `auth` schema, i.e. whether upgrade
 * sends can (and therefore MUST) reconcile phone/email claims. Unset counts
 * as available on purpose: against a database that unexpectedly lacks the
 * schema, reconciliation then fails the send loudly instead of being
 * silently skipped — only an explicit "false" opts out.
 */
export const authSchemaAvailable = env.AUTH_SCHEMA_AVAILABLE !== "false";

/**
 * Fail-closed production gate for the auth funnel's security config. Each
 * item, when absent, silently DISABLES a control rather than erroring:
 *
 *  - no Turnstile site key → no widget is mounted, so `requireCaptchaToken`
 *    never demands a token and CAPTCHA is off across the whole funnel;
 *  - no service-role key → `deleteAuthUser` degrades to a logged no-op and
 *    reconciliation stops removing orphaned GoTrue users — reinstating the
 *    phone_change collision bug acceptance tests 15/16 close out;
 *  - no DATABASE_URL → `guardUpgradeSend` degrades to allow-all: no
 *    throttle, no reconciliation, while Supabase still sends real SMS;
 *  - AUTH_SCHEMA_AVAILABLE=false → reconciliation is explicitly skipped,
 *    which is a dev-only posture.
 *
 * Acceptable degradations on a fresh clone; not in production with auth
 * live. Runs at import (below) whenever a production server has Supabase
 * configured — without Supabase the funnel is inert and nothing fails open.
 */
export function assertProductionSecurityConfig(): void {
  const missing: string[] = [];
  if (!optionalEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY")) {
    missing.push("NEXT_PUBLIC_TURNSTILE_SITE_KEY (CAPTCHA silently off without it)");
  }
  if (!optionalEnv("SUPABASE_SERVICE_ROLE_KEY")) {
    missing.push(
      "SUPABASE_SERVICE_ROLE_KEY (orphaned auth users never deleted without it)",
    );
  }
  if (!optionalEnv("DATABASE_URL")) {
    missing.push("DATABASE_URL (OTP throttle and claim reconciliation off without it)");
  }
  if (env.AUTH_SCHEMA_AVAILABLE === "false") {
    missing.push(
      'AUTH_SCHEMA_AVAILABLE="false" (claim reconciliation explicitly disabled)',
    );
  }
  if (missing.length > 0) {
    throw new Error(
      "Refusing to run the auth funnel in production with security config " +
        `incomplete:\n${missing.map((m) => `  - ${m}`).join("\n")}\n` +
        "See apps/web/docs/pre-launch-security.md (item 3).",
    );
  }
}

/*
 * Coming-soon deploys skip the gate on purpose: the OTP actions are hard-
 * disabled (`comingSoonClosed` in actions/auth.ts), so the funnel's auth is
 * inert and none of the guarded controls can fail open.
 */
if (
  typeof window === "undefined" &&
  isProd &&
  env.NEXT_PUBLIC_SUPABASE_URL &&
  !isComingSoon()
) {
  assertProductionSecurityConfig();
}

/*
 * Fail-closed production gate for transactional email. Both of these fail
 * SILENTLY when unset, which is the whole reason they are checked at boot:
 *
 *  - RESEND_API_KEY — the notifier degrades to console, so booking
 *    confirmations vanish into a log nobody reads;
 *  - OPS_ALERT_EMAIL — `exceptionOpsAlertEmail` logs
 *    "OPS_ALERT_EMAIL not configured; skipping exception email." and
 *    returns, so every ops alert is dropped while the deploy looks healthy.
 *    Now that core emits `booking/exception_raised` from ALL seven states
 *    that can raise one, a production deploy missing this address loses the
 *    entire alerting path rather than one webhook's worth of it.
 *
 * The runtime skip-and-log stays in place as defense in depth — this gate
 * makes it unreachable in production, not redundant.
 *
 * Exemptions, each deliberate:
 *  - coming-soon deploys — no booking can complete, nothing sends;
 *  - no Supabase — the funnel is inert scaffold, same as the auth gate;
 *  - the build phase — `next build` runs with NODE_ENV=production on
 *    credential-less machines by design (zero-config-boot rule above); the
 *    assertion is about SERVING production, and the deployed server's boot
 *    still enforces it.
 *
 * Dev is untouched: both stay optional, and their absence is the normal
 * zero-credentials local experience.
 */
if (
  typeof window === "undefined" &&
  isProd &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  env.NEXT_PUBLIC_SUPABASE_URL &&
  !isComingSoon()
) {
  if (!env.RESEND_API_KEY) {
    throw new Error(
      "RESEND_API_KEY is required in production: transactional email would " +
        "silently degrade to console logging. Set the key (and RESEND_FROM " +
        "once the sending domain is verified), or deploy with " +
        "NEXT_PUBLIC_LAUNCH_MODE=coming_soon.",
    );
  }
  if (!env.OPS_ALERT_EMAIL) {
    throw new Error(
      "OPS_ALERT_EMAIL is required in production: without it every " +
        "booking/exception_raised alert is skipped with a log line and no " +
        "one is paged when a booking hits the exception state. Set the ops " +
        "inbox address, or deploy with NEXT_PUBLIC_LAUNCH_MODE=coming_soon.",
    );
  }
  /*
   * The third silent degradation, and the one that cost the most: without a
   * key, `resolveExtractionConfig` quietly returns the in-process heuristic
   * extractor instead of Claude. Uploads still succeed, still report
   * "extracted", and still prefill the review form — with a passenger name
   * taken from a heading, a departure time taken from a printed DURATION,
   * and no second leg at all on a round trip. Nothing in the UI, the logs or
   * the response distinguishes it from a good read. Measured over twelve
   * ticket fixtures the heuristic was confidently wrong on five of them
   * where the Claude adapter was right on all twelve
   * (docs/run-reports/RUN-REPORT-8.md, Phase 0).
   *
   * The heuristic stays as the zero-credentials local experience. It is not
   * a production fallback, and this is what stops it becoming one by
   * accident.
   */
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is required in production: ticket extraction would " +
        "silently fall back to the in-process heuristic reader, which cannot " +
        "read a photographed ticket at all, reports only one leg of a " +
        "multi-leg itinerary, and has been measured mis-reading passenger " +
        "names and departure times. Set the key, or deploy with " +
        "NEXT_PUBLIC_LAUNCH_MODE=coming_soon.",
    );
  }
  /*
   * Web push, all three or none.
   *
   * Without them `createWebPushSender` returns null and the runtime falls back
   * to `ConsolePushSender` — which logs and reports SUCCESS, so every send
   * "works" and no device ever rings. Same class of silent degradation as the
   * three above, and worse here because it is the channel a driver relies on
   * with the tab closed.
   *
   * Push is never load-bearing (§7): email and the in-app signal still arrive.
   * This gate exists so the channel is either configured or deliberately
   * absent, never accidentally inert.
   *
   * WAIVED when the kill switch is off, which is the default. "Push is
   * deliberately disabled" is the one case where a console sender is the
   * right answer, so a production deploy with push off needs no VAPID vars
   * at all and boots clean.
   */
  if (
    env.NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED === "true" &&
    (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT)
  ) {
    throw new Error(
      "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are required in " +
        "production: without all three, web push silently degrades to console " +
        "logging — every send reports success and no device receives anything. " +
        "Generate a pair ONCE with `pnpm push:vapid` (regenerating invalidates " +
        "every stored subscription), or deploy with " +
        "NEXT_PUBLIC_LAUNCH_MODE=coming_soon.",
    );
  }
  /*
   * Checked separately because it is a DIFFERENT variable that has to carry
   * the same value, and forgetting it is the likely mistake: a server that can
   * send with a browser that can never subscribe is a configuration nobody
   * means.
   */
  if (
    env.NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED === "true" &&
    !env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  ) {
    throw new Error(
      "NEXT_PUBLIC_VAPID_PUBLIC_KEY is required in production: the browser " +
        "needs the VAPID public key to subscribe, so without it nobody can " +
        "ever enable notifications. Set it to the same value as " +
        "VAPID_PUBLIC_KEY.",
    );
  }
  /*
   * MONEY. Four variables, no gate — until Tier 5. The pre-flight called this
   * the notable hole (§2.4, §6.8): nothing refused a production boot with
   * payments unconfigured.
   *
   * Each fails differently and none of them fails loudly:
   *
   *  - STRIPE_SECRET_KEY absent ⇒ `resolvePaymentConfig` returns the
   *    IN-MEMORY FAKE provider. The pay step "works", a booking is confirmed,
   *    and no card is ever charged.
   *  - NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY absent while the secret is present
   *    ⇒ `stripeCheckoutState()` is "misconfigured": the runtime would
   *    authorize against real Stripe but the browser can never confirm.
   *    Honest, but discovered by a customer rather than by the boot.
   *  - STRIPE_WEBHOOK_SECRET absent ⇒ `verifyWebhook` refuses every delivery,
   *    so nothing ever moves to `paid` and every booking sits unconfirmed
   *    while Stripe's dashboard fills with failures nobody is watching.
   *  - CRON_SECRET absent is the quiet one, and the worst. `/api/jobs/*` 503s
   *    while the Inngest cron still runs, so bookings complete, bags move,
   *    customers are happy — and AUTHORIZATIONS ARE NEVER CAPTURED. They
   *    expire. The only symptom is money that does not arrive.
   *
   * Same exemptions as the block they sit in: coming-soon, no Supabase, and
   * the build phase. A coming-soon deploy cannot take a payment, so it needs
   * none of these.
   */
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error(
      "STRIPE_SECRET_KEY is required in production: without it the runtime " +
        "uses the in-memory FAKE payment provider, so the pay step succeeds, " +
        "the booking is confirmed, and no card is ever charged. Set the key, " +
        "or deploy with NEXT_PUBLIC_LAUNCH_MODE=coming_soon.",
    );
  }
  if (!env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
    throw new Error(
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is required in production: a live " +
        "secret key with no publishable key puts the pay step into " +
        "'misconfigured' — the server would authorize against real Stripe " +
        "and the browser could never confirm. Both keys move in the SAME " +
        "deploy, live and test alike.",
    );
  }
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is required in production: `verifyWebhook` " +
        "refuses an unsigned payload rather than trusting it, so every Stripe " +
        "delivery is rejected and no booking ever reaches `paid`. It is the " +
        "endpoint's OWN secret — a test-mode value against a live endpoint " +
        "makes every event a signed 400.",
    );
  }
  if (!env.CRON_SECRET) {
    throw new Error(
      "CRON_SECRET is required in production: without it /api/jobs/* refuses " +
        "to run while the Inngest capture cron keeps going, so bookings " +
        "complete and bags move and authorizations are never captured — they " +
        "expire, and the only symptom is money that never arrives. Set any " +
        "random string, or deploy with NEXT_PUBLIC_LAUNCH_MODE=coming_soon.",
    );
  }
}

/* ------------------------------------------------------------------ */
/* Dev-only diagnostics                                                */
/* ------------------------------------------------------------------ */

export interface ServiceStatus {
  service: string;
  configured: boolean;
  /** Behaviour when the credentials are absent. */
  fallback: string;
  keys: EnvKey[];
}

/** Powers the dev-only <EnvStatus /> panel on the home page. */
export function describeEnvStatus(): ServiceStatus[] {
  const has = (...keys: EnvKey[]) => keys.every((k) => Boolean(optionalEnv(k)));

  return [
    {
      service: "Postgres (Supabase)",
      configured: has("DATABASE_URL"),
      fallback: "Pages that read data render an empty state.",
      keys: ["DATABASE_URL"],
    },
    {
      service: "Supabase client (Realtime/Storage)",
      configured: has("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      fallback: "Timeline falls back to server-side fetch, no live updates.",
      keys: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    },
    {
      service: "Turnstile (bot protection)",
      configured: has("NEXT_PUBLIC_TURNSTILE_SITE_KEY"),
      fallback:
        "Auth calls send no captchaToken — enable Supabase CAPTCHA protection only once this is set.",
      keys: ["NEXT_PUBLIC_TURNSTILE_SITE_KEY"],
    },
    {
      service: "Stripe",
      configured: has("STRIPE_SECRET_KEY"),
      fallback: "Checkout uses FakePaymentProvider.",
      keys: [
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      ],
    },
    {
      service: "Inngest",
      configured: has("INNGEST_EVENT_KEY"),
      fallback: "Works against the local Inngest dev server (`pnpm dev:inngest`).",
      keys: ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"],
    },
    {
      service: "Resend email",
      configured: has("RESEND_API_KEY"),
      fallback: "Notifier logs to console.",
      keys: ["RESEND_API_KEY", "RESEND_FROM"],
    },
    {
      service: "AeroAPI (flights)",
      configured: has("AEROAPI_KEY"),
      fallback: "Flight lookup is stubbed.",
      keys: ["AEROAPI_KEY"],
    },
    {
      service: "Google Maps (Routes + Places)",
      configured: has("GOOGLE_MAPS_SERVER_KEY"),
      fallback:
        "Drive-time ETAs come from ZIP centroids and an average speed, and " +
        "the address step has no autocomplete.",
      keys: ["GOOGLE_MAPS_SERVER_KEY"],
    },
    {
      service: "Anthropic",
      configured: has("ANTHROPIC_API_KEY"),
      fallback:
        "Ticket extraction falls back to the text-layer heuristic: no " +
        "photographed tickets, one leg only, every field low-confidence.",
      keys: ["ANTHROPIC_API_KEY"],
    },
    {
      service: "Sentry",
      configured: has("NEXT_PUBLIC_SENTRY_DSN"),
      fallback: "Errors and ops alerts log to console only — nothing is recorded.",
      keys: ["NEXT_PUBLIC_SENTRY_DSN"],
    },
  ];
}

/**
 * One-shot dev warning listing unconfigured services. Never fires in
 * production, never throws.
 */
let warned = false;
export function warnMissingEnvOnce(appName: string): void {
  if (warned || !isDev || typeof window !== "undefined") return;
  warned = true;

  const missing = describeEnvStatus().filter((s) => !s.configured);
  if (missing.length === 0) return;

  console.warn(
    `[${appName}] ${missing.length} service(s) not configured — running with fallbacks:\n` +
      missing.map((s) => `  · ${s.service} → ${s.fallback}`).join("\n") +
      `\n  Copy .env.example to .env.local to configure.`,
  );
}

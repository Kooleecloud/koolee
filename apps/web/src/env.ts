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
  /** Direct connection, port 5432. Migrations only. */
  DIRECT_DATABASE_URL: optionalString,

  // --- Supabase (auth, Realtime, Storage) --------------------------------
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
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
   * RFC 5322 From for transactional email. The default is Resend's sandbox
   * sender — fine for dev/testing, but real deliveries need a verified
   * domain: set RESEND_FROM to e.g. `Koolee <notify@koolee.com>` once the
   * domain's DKIM/SPF records are in place (see the manual-setup doc).
   */
  RESEND_FROM: z.string().default("Koolee <onboarding@resend.dev>"),

  // --- Third-party data --------------------------------------------------
  AEROAPI_KEY: optionalString,
  GOOGLE_MAPS_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,

  // --- Observability -----------------------------------------------------
  SENTRY_DSN: optionalString,
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
  DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,

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

  AEROAPI_KEY: process.env.AEROAPI_KEY,
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,

  SENTRY_DSN: process.env.SENTRY_DSN,
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
  DIRECT_DATABASE_URL:
    "Supabase → Project Settings → Database → Direct connection (port 5432). Migrations only.",
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
  GOOGLE_MAPS_API_KEY: "Google Cloud Console → Maps Platform. Stubbed in this scaffold.",
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
    missing.push("SUPABASE_SERVICE_ROLE_KEY (orphaned auth users never deleted without it)");
  }
  if (!optionalEnv("DATABASE_URL")) {
    missing.push("DATABASE_URL (OTP throttle and claim reconciliation off without it)");
  }
  if (env.AUTH_SCHEMA_AVAILABLE === "false") {
    missing.push('AUTH_SCHEMA_AVAILABLE="false" (claim reconciliation explicitly disabled)');
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
if (typeof window === "undefined" && isProd && env.NEXT_PUBLIC_SUPABASE_URL && !isComingSoon()) {
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
      keys: ["DATABASE_URL", "DIRECT_DATABASE_URL"],
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
      service: "Google Maps",
      configured: has("GOOGLE_MAPS_API_KEY"),
      fallback: "Drive time uses a fixed estimate.",
      keys: ["GOOGLE_MAPS_API_KEY"],
    },
    {
      service: "Anthropic",
      configured: has("ANTHROPIC_API_KEY"),
      fallback: "Ticket-PDF extraction is out of scope for this scaffold.",
      keys: ["ANTHROPIC_API_KEY"],
    },
    {
      service: "Sentry",
      configured: has("SENTRY_DSN"),
      fallback: "Ops alerts log to console.",
      keys: ["SENTRY_DSN"],
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

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
 *
 * NEXT_PUBLIC_* vars are referenced as literal `process.env.X` member
 * expressions so the Next compiler can inline them into the client bundle.
 */

const optionalString = z.string().min(1).optional().catch(undefined);
const optionalUrl = z.string().url().optional().catch(undefined);

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development")
    .catch("development"),

  // --- App ---------------------------------------------------------------
  /** Absolute origin of this app. Used to build absolute links and callbacks. */
  NEXT_PUBLIC_APP_URL: optionalUrl,

  // --- Database (Supabase Postgres) -------------------------------------
  /** Supavisor transaction-mode pooler, port 6543. Runtime queries. */
  DATABASE_URL: optionalString,
  /** Direct connection, port 5432. Migrations only. */
  DIRECT_DATABASE_URL: optionalString,

  // --- Supabase (client SDK: Realtime + Storage only) --------------------
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,

  // --- Payments ----------------------------------------------------------
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalString,

  // --- Background jobs ---------------------------------------------------
  INNGEST_EVENT_KEY: optionalString,
  INNGEST_SIGNING_KEY: optionalString,

  // --- Notifications -----------------------------------------------------
  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  TWILIO_MESSAGING_SERVICE_SID: optionalString,
  RESEND_API_KEY: optionalString,

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

  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,

  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,

  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,

  INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
  INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,

  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_SERVICE_SID: process.env.TWILIO_MESSAGING_SERVICE_SID,
  RESEND_API_KEY: process.env.RESEND_API_KEY,

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

export const isDev = env.NODE_ENV === "development";
export const isProd = env.NODE_ENV === "production";

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
      service: "Twilio SMS",
      configured: has("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"),
      fallback: "Notifier logs to console.",
      keys: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_MESSAGING_SERVICE_SID"],
    },
    {
      service: "Resend email",
      configured: has("RESEND_API_KEY"),
      fallback: "Notifier logs to console.",
      keys: ["RESEND_API_KEY"],
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

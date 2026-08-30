import { z } from "zod";

/**
 * Environment access for apps/admin (ops console).
 *
 * Same contract as apps/web: importing never throws, everything is optional at
 * parse time, and a var only becomes required when a code path that needs it
 * actually runs. See the root README for the full env table.
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

  /** Absolute origin of this app. Used to build absolute links and callbacks. */
  NEXT_PUBLIC_APP_URL: optionalUrl,

  /** Origin of the agent app — agent invite links must land THERE. */
  NEXT_PUBLIC_AGENT_APP_URL: optionalUrl,

  DATABASE_URL: optionalString,
  // DIRECT_DATABASE_URL is deliberately NOT read here: it is a hosted DDL
  // credential and belongs in packages/db/.env alone (see .env.example).

  NEXT_PUBLIC_SUPABASE_URL: supabaseApiUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,

  /**
   * Cloudflare Turnstile SITE key. Required whenever the Supabase project has
   * CAPTCHA protection on — that is a PROJECT setting, so enabling it for the
   * customer funnel gates this app's `signInWithPassword` and
   * `resetPasswordForEmail` too. Absent, those calls fail with
   * "captcha protection: request disallowed (no captcha_token found)".
   *
   * Must be the SAME site key apps/web uses for this environment: the secret
   * is a single per-Supabase-project value and lives only in the Supabase
   * dashboard, never here.
   */
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,

  STRIPE_SECRET_KEY: optionalString,
  /**
   * Event key for the shared Inngest app. This app SENDS domain events (an
   * ops override moving a booking to exception) but serves no functions —
   * the registry and the signing key live in apps/web. Unset is fine
   * locally: the dev server accepts unauthenticated sends.
   */
  INNGEST_EVENT_KEY: optionalString,
  SENTRY_DSN: optionalString,
});

export type Env = z.infer<typeof schema>;
export type EnvKey = keyof Env;

const raw = {
  NODE_ENV: process.env.NODE_ENV,

  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_AGENT_APP_URL: process.env.NEXT_PUBLIC_AGENT_APP_URL,

  DATABASE_URL: process.env.DATABASE_URL,

  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,

  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
  SENTRY_DSN: process.env.SENTRY_DSN,
};

export const env: Env = schema.parse(raw);

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
  STRIPE_SECRET_KEY: "Stripe Dashboard → Developers → API keys. Needed for refunds.",
};

export function requireEnv(key: EnvKey): string {
  const value = env[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new MissingEnvError(key, HINTS[key] ?? "See .env.example.");
  }
  return value;
}

export function optionalEnv(key: EnvKey): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const isDev = env.NODE_ENV === "development";
export const isProd = env.NODE_ENV === "production";

/**
 * Fail-loud production gate (same `isProd` convention as apps/web).
 *
 * Each of these, absent, silently disables something ops depends on rather
 * than erroring: no Supabase URL/anon key → admin sign-in unavailable; no
 * service-role key → staff invites and evidence-photo signed URLs degrade to
 * no-ops; no agent-app origin → agent invite links land on the wrong app.
 * In production that silence is a misconfiguration, so the boot refuses.
 */
export function assertProductionBootConfig(): void {
  const missing: string[] = [];
  if (!optionalEnv("NEXT_PUBLIC_SUPABASE_URL")) {
    missing.push(
      "NEXT_PUBLIC_SUPABASE_URL (admin sign-in silently unavailable without it)",
    );
  }
  if (!optionalEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
    missing.push(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY (admin sign-in silently unavailable without it)",
    );
  }
  if (!optionalEnv("SUPABASE_SERVICE_ROLE_KEY")) {
    missing.push(
      "SUPABASE_SERVICE_ROLE_KEY (staff invites and evidence-photo signed URLs degrade to no-ops)",
    );
  }
  if (!optionalEnv("NEXT_PUBLIC_AGENT_APP_URL")) {
    missing.push(
      "NEXT_PUBLIC_AGENT_APP_URL (agent invite links would land on the wrong app)",
    );
  }
  if (missing.length > 0) {
    throw new Error(
      "Refusing to run the admin app in production with ops config missing:\n" +
        missing.map((m) => `  - ${m}`).join("\n") +
        "\nSee apps/admin/.env.example.",
    );
  }
}

/*
 * `next build` itself runs with NODE_ENV=production and must stay green on a
 * credential-less fresh clone (the repo-wide contract), so the build phase is
 * exempt; the gate fires when a production SERVER actually boots. The
 * `typeof window` guard keeps client bundles from throwing over server env.
 */
if (
  typeof window === "undefined" &&
  isProd &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  assertProductionBootConfig();
}

export interface ServiceStatus {
  service: string;
  configured: boolean;
  fallback: string;
  keys: EnvKey[];
}

export function describeEnvStatus(): ServiceStatus[] {
  const has = (...keys: EnvKey[]) => keys.every((k) => Boolean(optionalEnv(k)));

  return [
    {
      service: "Postgres (Supabase)",
      configured: has("DATABASE_URL"),
      fallback: "Bookings table renders an empty state.",
      keys: ["DATABASE_URL"],
    },
    {
      service: "Supabase client (Realtime)",
      configured: has("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      fallback: "Ops views do not live-update.",
      keys: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    },
    {
      service: "Stripe",
      configured: has("STRIPE_SECRET_KEY"),
      fallback: "Refund actions use FakePaymentProvider.",
      keys: ["STRIPE_SECRET_KEY"],
    },
    {
      service: "Sentry",
      configured: has("SENTRY_DSN"),
      fallback: "Errors log to console.",
      keys: ["SENTRY_DSN"],
    },
  ];
}

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

import { z } from "zod";

/**
 * Environment access for apps/agent (check-in agent + driver PWA).
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

  DATABASE_URL: optionalString,

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
   * The SAME pair apps/web holds. All four are needed here because this app
   * SENDS: `/api/push/test` pushes a test notification to your own devices,
   * and without the private key the runtime falls back to
   * `ConsolePushSender`, which logs a line and reports SUCCESS — so the
   * "did you see it?" check asks about a notification that was never sent.
   *
   * Generate once with `pnpm push:vapid`; regenerating invalidates every
   * stored subscription. See docs/features/f3-hosted-setup.md.
   */
  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalString,
  /** `mailto:` or `https:`. Apple REFUSES a push whose subject is neither. */
  VAPID_SUBJECT: optionalString,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: optionalString,
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

  /**
   * Event key for the shared Inngest app. This app SENDS domain events (a
   * booking raising an exception) but serves no functions — the registry and
   * the signing key live in apps/web. Unset is fine locally: the dev server
   * accepts unauthenticated sends.
   */
  INNGEST_EVENT_KEY: optionalString,
  SENTRY_DSN: optionalString,
});

export type Env = z.infer<typeof schema>;
export type EnvKey = keyof Env;

const raw = {
  NODE_ENV: process.env.NODE_ENV,

  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,

  DATABASE_URL: process.env.DATABASE_URL,
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED:
    process.env.NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED,

  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,

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
 * Fail-loud production gate (same `isProd` convention as apps/web).
 *
 * Staff sign-in IS this app: with the Supabase URL or anon key missing, every
 * page silently degrades to an unusable login screen instead of an error
 * anyone can act on. In production that silence is a misconfiguration, so the
 * boot refuses instead.
 */
export function assertProductionBootConfig(): void {
  const missing: string[] = [];
  if (!optionalEnv("NEXT_PUBLIC_SUPABASE_URL")) {
    missing.push(
      "NEXT_PUBLIC_SUPABASE_URL (staff sign-in silently unavailable without it)",
    );
  }
  if (!optionalEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
    missing.push(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY (staff sign-in silently unavailable without it)",
    );
  }
  /*
   * Push, all four or none.
   *
   * Not "nice to have": the fallback is `ConsolePushSender`, which logs and
   * REPORTS SUCCESS. Without these, every notification this app sends looks
   * sent, nothing arrives, and the one mechanism built to detect that — the
   * did-you-see-it check — is itself lying. Push is never load-bearing, so
   * this does not block the product; it blocks the SILENT version of it.
   */
  const push = (
    ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "NEXT_PUBLIC_VAPID_PUBLIC_KEY"] as const
  ).filter((key) => !optionalEnv(key));
  // Waived while push is off (the default): a console sender is the correct
  // answer when the channel is deliberately disabled.
  if (pushNotificationsEnabled() && push.length > 0 && push.length < 4) {
    missing.push(
      `${push.join(", ")} (push is half-configured: sends would silently log instead of delivering)`,
    );
  }

  if (missing.length > 0) {
    throw new Error(
      "Refusing to run the agent app in production with auth config missing:\n" +
        missing.map((m) => `  - ${m}`).join("\n") +
        "\nSee apps/agent/.env.example.",
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
      fallback: "Task list renders an empty state.",
      keys: ["DATABASE_URL"],
    },
    {
      // Least privilege: this app holds NO service-role key (a shared,
      // frequently-lost device must not carry it). Auth + any Storage access
      // go through the anon key + the signed-in agent's own session.
      service: "Supabase (staff auth, Storage)",
      configured: has("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      fallback: "Sign-in is unavailable; photo capture stays local.",
      keys: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
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

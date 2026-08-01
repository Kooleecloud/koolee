import { z } from "zod";

/**
 * Environment access for apps/agent (check-in agent + driver PWA).
 *
 * Same contract as apps/web: importing never throws, everything is optional at
 * parse time, and a var only becomes required when a code path that needs it
 * actually runs. See the root README for the full env table.
 */

const optionalString = z.string().min(1).optional().catch(undefined);
const optionalUrl = z.string().url().optional().catch(undefined);

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development")
    .catch("development"),

  /** Absolute origin of this app. Used to build absolute links and callbacks. */
  NEXT_PUBLIC_APP_URL: optionalUrl,

  DATABASE_URL: optionalString,
  DIRECT_DATABASE_URL: optionalString,

  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,

  GOOGLE_MAPS_API_KEY: optionalString,
  SENTRY_DSN: optionalString,
});

export type Env = z.infer<typeof schema>;
export type EnvKey = keyof Env;

const raw = {
  NODE_ENV: process.env.NODE_ENV,

  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,

  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,

  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,

  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
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
  DIRECT_DATABASE_URL:
    "Supabase → Project Settings → Database → Direct connection (port 5432).",
  SUPABASE_SERVICE_ROLE_KEY:
    "Supabase → Project Settings → API → service_role key. Needed for Storage uploads.",
  GOOGLE_MAPS_API_KEY: "Google Cloud Console → Maps Platform. Stubbed in this scaffold.",
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
      keys: ["DATABASE_URL", "DIRECT_DATABASE_URL"],
    },
    {
      service: "Supabase Storage (bag photos)",
      configured: has("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"),
      fallback: "Photo capture stays local; nothing is uploaded.",
      keys: [
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
      ],
    },
    {
      service: "Google Maps",
      configured: has("GOOGLE_MAPS_API_KEY"),
      fallback: "Route ETA uses a fixed estimate.",
      keys: ["GOOGLE_MAPS_API_KEY"],
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

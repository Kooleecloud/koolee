import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * The app's config is `app.json`; this file adds one check on top of it.
 *
 * A BUILD THAT SHIPS REFUSES TO BUILD WITHOUT A BACKEND. The API and Supabase
 * addresses are `EXPO_PUBLIC_*` values that Metro bakes into the bundle, read
 * from the EAS environment the build profile names (`eas.json`). Before this,
 * an empty environment built without complaint: `env.ts` fell back to
 * `http://localhost:3001`, and testers got an app that installs and can
 * never sign in.
 *
 * It only runs on the EAS build server (`EAS_BUILD`), where the environment
 * is loaded, and only for the profiles that put the app in someone's hands.
 * Local development and development builds never trip it: they read
 * `.env.local`, and a dev client loads its JavaScript from Metro anyway.
 */
export const SHIPPING_PROFILES = [
  "preview",
  "preview-simulator",
  "beta",
  "production",
] as const;

const REQUIRED = [
  "EXPO_PUBLIC_API_URL",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
] as const;

const ADDRESSES = ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_SUPABASE_URL"] as const;
const THIS_MACHINE = /\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(?=[:/]|$)/;

/** Why this environment cannot ship; empty when it can, or when this is not a shipping build. */
export function shippingEnvProblems(env: Record<string, string | undefined>): string[] {
  if (env.EAS_BUILD !== "true") return [];
  const profile = env.EAS_BUILD_PROFILE ?? "";
  if (!(SHIPPING_PROFILES as readonly string[]).includes(profile)) return [];

  const problems: string[] = REQUIRED.filter((key) => !env[key]?.trim()).map(
    (key) => `${key} is not set`,
  );
  for (const key of ADDRESSES) {
    const value = env[key]?.trim();
    if (!value) continue;
    if (THIS_MACHINE.test(value))
      problems.push(`${key} points at a development machine (${value})`);
    else if (!value.startsWith("https://"))
      problems.push(`${key} is not https (${value})`);
  }
  return problems;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const problems = shippingEnvProblems(process.env);
  if (problems.length > 0) {
    throw new Error(
      `The "${process.env.EAS_BUILD_PROFILE}" build goes to testers or a store, but its EAS environment cannot reach a backend:\n` +
        problems.map((problem) => `  - ${problem}`).join("\n") +
        "\nSet the values in that profile's EAS environment (CHECKLIST D2), then build again.",
    );
  }
  return config as ExpoConfig;
};

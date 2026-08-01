import { NotAuthenticatedError } from "../errors";
import type { CustomerSession } from "./types";

/**
 * Customer session verification against Supabase phone-OTP auth.
 *
 * Deliberately implemented with `fetch` against the Supabase auth REST API
 * rather than `@supabase/supabase-js`:
 *
 *  - it keeps a heavyweight SDK out of the domain package;
 *  - it makes the network call explicit and injectable for tests;
 *  - `GET /auth/v1/user` validates the JWT server-side, so a revoked or expired
 *    token is rejected. Locally decoding the JWT would not catch revocation.
 *
 * The cost is one HTTP round trip per verification. Cache at the request level
 * in the app if that shows up in traces.
 */

export interface SupabaseAuthConfig {
  /** e.g. https://xyzcompany.supabase.co */
  url: string;
  /** The anon public key. */
  anonKey: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface SupabaseUserResponse {
  id: string;
  phone?: string;
  email?: string;
  user_metadata?: { full_name?: string };
  role?: string;
}

/**
 * Exchanges a Supabase access token for a `CustomerSession`.
 *
 * Returns null for "not signed in" (no token, expired token, revoked token).
 * Throws only when the auth service itself is unreachable or misconfigured —
 * an outage must not silently read as "signed out".
 */
export async function verifySupabaseCustomerSession(
  accessToken: string | null | undefined,
  config: SupabaseAuthConfig,
): Promise<CustomerSession | null> {
  if (!accessToken) return null;

  const doFetch = config.fetchImpl ?? globalThis.fetch;
  if (!doFetch) {
    throw new NotAuthenticatedError(
      "No fetch implementation available to verify the Supabase session.",
    );
  }

  const init: RequestInit = {
    method: "GET",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  };
  // Next.js extends fetch with caching semantics; Node's RequestInit typings do
  // not carry `cache`. A cached session check would serve a revoked token.
  (init as RequestInit & { cache?: string }).cache = "no-store";

  const response = await doFetch(`${trimTrailingSlash(config.url)}/auth/v1/user`, init);

  // 401/403 mean the token is not valid — that is "signed out", not an error.
  if (response.status === 401 || response.status === 403) return null;

  if (!response.ok) {
    throw new NotAuthenticatedError(
      `Supabase auth returned ${response.status} while verifying the session. ` +
        `Treating this as an outage rather than a sign-out.`,
    );
  }

  const user = (await response.json()) as SupabaseUserResponse;
  if (!user.id) return null;

  return {
    kind: "customer",
    role: "customer",
    userId: user.id,
    phone: user.phone ?? "",
    email: user.email ?? null,
    fullName: user.user_metadata?.full_name ?? null,
  };
}

/**
 * Builds a `CustomerSessionReader` from a function that produces the access
 * token for the current request (typically a cookie read in the app layer).
 */
export function createSupabaseCustomerSessionReader(
  config: SupabaseAuthConfig,
  getAccessToken: () => Promise<string | null | undefined>,
): { getSession: () => Promise<CustomerSession | null> } {
  return {
    async getSession() {
      const token = await getAccessToken();
      return verifySupabaseCustomerSession(token, config);
    },
  };
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

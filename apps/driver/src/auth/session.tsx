import * as React from "react";
import { apiRoutes, meResponseSchema, type MeResponse } from "@koolee/api-contract";

import { apiFetch, ApiRequestError } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { stopTracking } from "@/location/tracking";

import {
  CAPTCHA_FAILED_COPY,
  isCaptchaError,
  NO_ACCESS_COPY,
  normalizeEmail,
  SIGN_IN_FAILED_COPY,
} from "./copy";

/**
 * Who is signed in, as far as the SERVER is concerned.
 *
 * A Supabase session alone is not enough: the boundary is the per-request
 * `staff_members` check behind `/api/v1/me`, exactly as on the web. So the
 * app is "signed in" only once `/me` has answered, and a 403 there (invited
 * account with no agent role, or a deactivated one) signs the device out
 * with the same sentence the web shows.
 */
export type SessionState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signed_in"; me: MeResponse };

export interface SessionApi {
  state: SessionState;
  signIn(input: {
    email: string;
    password: string;
    captchaToken?: string;
  }): Promise<string | null>;
  signOut(): Promise<void>;
  /** Re-reads /me — after a shift change, on foreground, on a realtime signal. */
  refresh(): Promise<MeResponse | null>;
}

const SessionContext = React.createContext<SessionApi | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<SessionState>({ status: "loading" });

  const loadMe = React.useCallback(async (): Promise<MeResponse | null> => {
    try {
      const me = await apiFetch(meResponseSchema, apiRoutes.me());
      setState({ status: "signed_in", me });
      return me;
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        (error.status === 401 || error.status === 403)
      ) {
        await supabase.auth.signOut().catch(() => undefined);
        setState({ status: "signed_out" });
        return null;
      }
      // Offline with a valid session: stay signed in on what we last knew,
      // or, on first launch with nothing known, show the signed-out door.
      setState((prev) => (prev.status === "signed_in" ? prev : { status: "signed_out" }));
      return null;
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session) {
        setState({ status: "signed_out" });
        return;
      }
      await loadMe();
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setState({ status: "signed_out" });
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadMe]);

  const signIn = React.useCallback<SessionApi["signIn"]>(
    async ({ email, password, captchaToken }) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizeEmail(email),
        password,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      });
      if (error || !data.user) {
        if (__DEV__)
          console.warn(
            "[auth] sign-in failed",
            error?.status,
            error?.name,
            error?.message,
          );
        if (isCaptchaError(error?.message)) return CAPTCHA_FAILED_COPY;
        // A dead network is not a wrong password. GoTrue's client wraps a
        // failed fetch in AuthRetryableFetchError (status 0) — say so,
        // instead of telling a driver with no signal to check their password.
        if (error && (error.status === 0 || /fetch|network/i.test(error.message))) {
          return "Couldn't reach Koolee. Check your connection and try again.";
        }
        return SIGN_IN_FAILED_COPY;
      }
      try {
        const me = await apiFetch(meResponseSchema, apiRoutes.me());
        setState({ status: "signed_in", me });
        return null;
      } catch (err) {
        await supabase.auth.signOut().catch(() => undefined);
        setState({ status: "signed_out" });
        if (err instanceof ApiRequestError && err.status === 403) return NO_ACCESS_COPY;
        return err instanceof Error ? err.message : SIGN_IN_FAILED_COPY;
      }
    },
    [],
  );

  const signOut = React.useCallback(async () => {
    await stopTracking().catch(() => undefined);
    await supabase.auth.signOut().catch(() => undefined);
    setState({ status: "signed_out" });
  }, []);

  const value = React.useMemo<SessionApi>(
    () => ({ state, signIn, signOut, refresh: loadMe }),
    [state, signIn, signOut, loadMe],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}

/** The signed-in identity, for screens that only render behind the gate. */
export function useMe(): MeResponse {
  const { state } = useSession();
  if (state.status !== "signed_in") throw new Error("useMe outside a signed-in screen");
  return state.me;
}

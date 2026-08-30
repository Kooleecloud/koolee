"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { normalizeEmail } from "@koolee/ui/lib/credentials";
import {
  attachEmail,
  attachVerifiedPhone,
  ConflictError,
  deleteAnonymousCustomer,
  ensureCustomerFromAuth,
  guardUpgradeOtpSend,
  reparentBookingDraft,
  sendBookingConfirmationEmail,
} from "@koolee/core";

import { authSchemaAvailable, isComingSoon, optionalEnv } from "@/env";
import { tryGetCore } from "@/lib/core";
import { syncDraftRow } from "@/lib/draft-sync";
import { toE164UsCa } from "@/lib/phone";
import { sanitizeReturnTo } from "@/lib/return-to";
import { deleteAuthUser } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * OTP delivery is owned by Supabase Auth (provider: Twilio Verify).
 * Credentials live ONLY in the Supabase dashboard — never in app env.
 * Do not import the Twilio SDK here. Codes are generated and validated by
 * Twilio Verify; Supabase never sees them and neither do we.
 *
 * Auth server actions: anonymous draft session, the OTP gate (Screens A/B),
 * returning sign-in, and post-booking email attach.
 *
 * Result convention: a typed union, never a thrown Supabase error. The client
 * branches on `code`, renders `message` verbatim (copy inventory in the spec),
 * and the happy path either returns `{ ok: true }` or redirects.
 */

export type AuthErrorCode =
  | "invalid_input"
  | "captcha_failed"
  | "resend_capped"
  | "rate_limited"
  | "PHONE_EXISTS"
  | "EMAIL_EXISTS"
  | "otp_invalid"
  | "not_configured"
  | "provider_error";

export type AuthActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; code: AuthErrorCode; message: string };

/** Which Supabase verification flow Screen B must complete. */
export type OtpMode = "phone_change" | "sms" | "email_change" | "email";

const RATE_LIMIT_COPY = "Too many attempts — try again in a minute.";
const CONFLICT_COPY = "That number already has bookings with us — sign in to continue.";

/**
 * Pre-launch hard stop: with NEXT_PUBLIC_LAUNCH_MODE=coming_soon every
 * account-creating or sign-in action refuses before touching Supabase. The
 * UI hides these paths too, but this is the layer that actually holds — the
 * actions are reachable as plain POST endpoints regardless of what renders.
 */
function comingSoonClosed(): { ok: false; code: AuthErrorCode; message: string } | null {
  if (!isComingSoon()) return null;
  return {
    ok: false,
    code: "not_configured",
    message: "Accounts are coming soon — you can't sign in just yet.",
  };
}

/* ------------------------------------------------------------------ */
/* Resend cap — server-side, per browser session                        */
/* ------------------------------------------------------------------ */

const OTP_SENDS_COOKIE = "koolee_otp_sends";
/** 1 initial send + 3 resends. */
const MAX_SENDS_PER_TARGET = 4;

async function bumpSendCounter(target: string): Promise<{ allowed: boolean; resendsLeft: number }> {
  const store = await cookies();
  let state: { target: string; sends: number } = { target, sends: 0 };
  try {
    const raw = store.get(OTP_SENDS_COOKIE)?.value;
    if (raw) {
      const parsed = JSON.parse(raw) as { target?: string; sends?: number };
      if (parsed.target === target && typeof parsed.sends === "number") {
        state = { target, sends: parsed.sends };
      }
    }
  } catch {
    // Corrupt cookie: start over.
  }

  if (state.sends >= MAX_SENDS_PER_TARGET) {
    return { allowed: false, resendsLeft: 0 };
  }

  state.sends += 1;
  store.set(OTP_SENDS_COOKIE, JSON.stringify(state), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 30,
    secure: process.env.NODE_ENV === "production",
  });
  return { allowed: true, resendsLeft: MAX_SENDS_PER_TARGET - state.sends };
}

/* ------------------------------------------------------------------ */
/* Shared plumbing                                                      */
/* ------------------------------------------------------------------ */

interface SupabaseishError {
  message: string;
  status?: number;
  code?: string;
}

function isRateLimit(error: SupabaseishError): boolean {
  return error.status === 429 || /rate limit|too many/i.test(error.message);
}

function isPhoneExists(error: SupabaseishError): boolean {
  return error.code === "phone_exists" || /phone.*already been registered/i.test(error.message);
}

function isEmailExists(error: SupabaseishError): boolean {
  return error.code === "email_exists" || /email.*already been registered/i.test(error.message);
}

function isOtpInvalid(error: SupabaseishError): boolean {
  return (
    error.code === "otp_expired" ||
    error.status === 403 ||
    /expired|invalid/i.test(error.message)
  );
}

/**
 * Turnstile verification is performed by Supabase Auth, not by us: the client
 * token is forwarded as `options.captchaToken` and GoTrue calls siteverify
 * with the secret that lives only in the Supabase dashboard. This app never
 * calls siteverify and holds no Turnstile secret.
 *
 * With no site key configured (fresh clone) the widget never rendered, so a
 * missing token is only an error when the widget was supposed to be there.
 * `updateUser()` cannot carry a token — those sends are covered by the
 * captcha-gated session + the `guardUpgradeSend` throttle instead.
 */
function requireCaptchaToken(
  token: string | null,
): AuthActionResult<{ token?: string }> {
  if (!token && optionalEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY")) {
    return {
      ok: false,
      code: "captcha_failed",
      message: "We couldn't confirm you're human. Refresh and try again.",
    };
  }
  return { ok: true, ...(token ? { token } : {}) };
}

function captchaOptions(token: string | undefined): { captchaToken?: string } {
  return token ? { captchaToken: token } : {};
}

/**
 * The two controls that stand in for the captcha on `updateUser()` sends
 * (anonymous → permanent upgrade), run BEFORE Supabase triggers the SMS/email:
 *
 *  1. server-side throttle — 3 sends / user / 15 min, 5 sends / destination /
 *     60 min across all users (`otp_send_log`);
 *  2. claim reconciliation — abandoned anonymous sessions holding the same
 *     phone/email in `auth.users.phone_change`/`email_change` are deleted so
 *     `verifyOtp` cannot attach the identifier to the wrong row, and an
 *     existing PERMANENT account is reported as a conflict before any SMS is
 *     sent (no verification fee, no error-message parsing).
 */
async function guardUpgradeSend(input: {
  userId: string;
  destination: string;
  kind: "phone" | "email";
  conflictMessage: string;
}): Promise<AuthActionResult> {
  const core = tryGetCore();
  // No database: scaffold degrade — Supabase's own limits still apply.
  if (!core) return { ok: true };

  try {
    // Throttle + reconciliation as ONE transaction under one lock scope —
    // two separate transactions release the destination lock in between,
    // and concurrent claims on the same number can interleave into the gap.
    // Whether reconciliation runs at all is the explicit env declaration
    // (`AUTH_SCHEMA_AVAILABLE`), not error-code sniffing: against a database
    // that unexpectedly lacks auth.users this now fails closed below.
    const guard = await guardUpgradeOtpSend(core.db, {
      userId: input.userId,
      destination: input.destination,
      kind: input.kind,
      reconcile: authSchemaAvailable,
      deleteAuthUser,
    });
    if (!guard.allowed) {
      return { ok: false, code: "rate_limited", message: RATE_LIMIT_COPY };
    }
    if (guard.conflict) {
      return {
        ok: false,
        code: input.kind === "phone" ? "PHONE_EXISTS" : "EMAIL_EXISTS",
        message: input.conflictMessage,
      };
    }
    return { ok: true };
  } catch (error) {
    // Fail closed: sending with an unresolved claim is the wrong-user bug
    // this guard exists for.
    console.error("[auth] upgrade-send guard failed", error);
    return {
      ok: false,
      code: "provider_error",
      message: "We couldn't send a code just now. Try again in a minute.",
    };
  }
}

/* ------------------------------------------------------------------ */
/* 1. Anonymous draft session                                           */
/* ------------------------------------------------------------------ */

export interface DraftSessionState {
  userId: string | null;
  /** False when anonymous sign-ins are disabled on the Supabase project. */
  anonymousAvailable: boolean;
}

/**
 * Called the FIRST time funnel state is persisted server-side (flight review
 * confirmed). Creates the anonymous Supabase session + `public.users` row +
 * draft row — or degrades to cookie-only state when anonymous sign-ins are
 * disabled, in which case the user is created at the OTP gate instead.
 *
 * `captchaToken` comes from the Turnstile field mounted on the flight form:
 * with CAPTCHA protection enabled on the Supabase project,
 * `signInAnonymously` fails without one.
 */
export async function ensureDraftSession(
  captchaToken: string | null = null,
): Promise<DraftSessionState> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { userId: null, anonymousAvailable: false };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let uid = user?.id ?? null;
  let isAnonymous = user?.is_anonymous === true;
  const anonymousAvailable = true;

  if (!uid) {
    const { data, error } = await supabase.auth.signInAnonymously({
      options: captchaOptions(captchaToken ?? undefined),
    });
    if (error || !data.user) {
      // Most likely `anonymous_provider_disabled` — the funnel continues on
      // cookie state and the user is created at the verification gate.
      if (error) console.warn(`[auth] signInAnonymously unavailable: ${error.message}`);
      return { userId: null, anonymousAvailable: false };
    }
    uid = data.user.id;
    isAnonymous = true;
  }

  const core = tryGetCore();
  if (core && uid) {
    try {
      await ensureCustomerFromAuth(core.db, {
        authUserId: uid,
        isAnonymous,
        phone: !isAnonymous && user?.phone ? `+${user.phone.replace(/^\+/, "")}` : null,
        email: !isAnonymous ? (user?.email ?? null) : null,
      });
      await syncDraftRow(uid);
    } catch (error) {
      console.error("[auth] ensureDraftSession customer/draft write failed", error);
    }
  }

  return { userId: uid, anonymousAvailable };
}

/* ------------------------------------------------------------------ */
/* 2. Send OTP (Screen A submit; also /login)                           */
/* ------------------------------------------------------------------ */

/**
 * Every email this file accepts, normalized BEFORE it is validated.
 *
 * `z.email()` alone rejects "  Alice@Koolee.cloud " for the whitespace and
 * then hands back the mixed case unchanged, so each call site was lowercasing
 * on its own — four times in this file, and `saveProfile` in the dashboard
 * did not do it at all. `preprocess` puts the normalization on the schema,
 * which is the one place that cannot be forgotten. Same helper the staff
 * apps' sign-in and the admin invite use.
 */
const emailField = z.preprocess(normalizeEmail, z.email());

const sendOtpSchema = z.object({
  phone: z.string().min(3).max(25).optional(),
  email: emailField.optional(),
  turnstileToken: z.string().nullable(),
  /** "upgrade" = funnel gate (anonymous → permanent). "signin" = /login or the phone-conflict flow. */
  intent: z.enum(["upgrade", "signin"]),
  isResend: z.boolean().optional(),
});

export interface SendOtpSuccess {
  mode: OtpMode;
  /** E.164 / normalized email the OTP was actually sent to. */
  target: string;
  resendsLeft: number;
  /** Set when the phone belongs to an existing account (conflict flow). */
  conflictFromUid?: string;
}

export async function sendOtp(
  input: z.infer<typeof sendOtpSchema>,
): Promise<AuthActionResult<SendOtpSuccess>> {
  const closed = comingSoonClosed();
  if (closed) return closed;

  const parsed = sendOtpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid_input", message: "Check the details and try again." };
  }
  const { turnstileToken, intent } = parsed.data;

  const captcha = requireCaptchaToken(turnstileToken);
  if (!captcha.ok) return captcha;

  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false,
      code: "not_configured",
      message: "Sign-in isn't available in this environment yet.",
    };
  }

  /* --- email path ---------------------------------------------------- */
  if (parsed.data.email) {
    const email = parsed.data.email;
    const counter = await bumpSendCounter(email);
    if (!counter.allowed) {
      return { ok: false, code: "resend_capped", message: RATE_LIMIT_COPY };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user && intent === "upgrade") {
      // `updateUser` cannot carry a captchaToken — throttle and reconcile
      // BEFORE Supabase sends anything (see guardUpgradeSend).
      const guard = await guardUpgradeSend({
        userId: user.id,
        destination: email,
        kind: "email",
        conflictMessage: "That email already has bookings with us — sign in to continue.",
      });
      if (!guard.ok) return guard;

      const { error } = await supabase.auth.updateUser({ email });
      if (error) {
        // Defensive fallback only — reconciliation reports conflicts first.
        if (isEmailExists(error)) {
          return {
            ok: false,
            code: "EMAIL_EXISTS",
            message:
              "That email already has bookings with us — sign in to continue.",
          };
        }
        if (isRateLimit(error)) {
          return { ok: false, code: "rate_limited", message: RATE_LIMIT_COPY };
        }
        return { ok: false, code: "provider_error", message: error.message };
      }
      return { ok: true, mode: "email_change", target: email, resendsLeft: counter.resendsLeft };
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, ...captchaOptions(captcha.token) },
    });
    if (error) {
      if (isRateLimit(error)) {
        return { ok: false, code: "rate_limited", message: RATE_LIMIT_COPY };
      }
      return { ok: false, code: "provider_error", message: error.message };
    }
    return { ok: true, mode: "email", target: email, resendsLeft: counter.resendsLeft };
  }

  /* --- phone path ------------------------------------------------------ */
  if (!parsed.data.phone) {
    return { ok: false, code: "invalid_input", message: "Enter your phone number." };
  }
  const e164 = toE164UsCa(parsed.data.phone);
  if (!e164) {
    return {
      ok: false,
      code: "invalid_input",
      message: "Enter a valid US or Canadian mobile number.",
    };
  }

  const counter = await bumpSendCounter(e164);
  if (!counter.allowed) {
    return { ok: false, code: "resend_capped", message: RATE_LIMIT_COPY };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Anonymous (or signed-in) user attaching/changing a phone: phone_change OTP,
  // same uid before and after.
  if (user && intent === "upgrade") {
    // `updateUser` cannot carry a captchaToken — throttle and reconcile
    // BEFORE Supabase sends the SMS (see guardUpgradeSend). A permanent
    // account holding this number comes back as `PHONE_EXISTS` here,
    // before any verification fee is incurred.
    const guard = await guardUpgradeSend({
      userId: user.id,
      destination: e164,
      kind: "phone",
      conflictMessage: CONFLICT_COPY,
    });
    if (!guard.ok) return guard;

    const { error } = await supabase.auth.updateUser({ phone: e164 });
    if (error) {
      // Defensive fallback only — reconciliation reports conflicts first.
      if (isPhoneExists(error)) {
        return {
          ok: false,
          code: "PHONE_EXISTS",
          message: CONFLICT_COPY,
        };
      }
      if (isRateLimit(error)) {
        return { ok: false, code: "rate_limited", message: RATE_LIMIT_COPY };
      }
      return { ok: false, code: "provider_error", message: error.message };
    }
    return { ok: true, mode: "phone_change", target: e164, resendsLeft: counter.resendsLeft };
  }

  // No session (anonymous sign-ins disabled, or cookies lost) or an explicit
  // sign-in: plain phone OTP. Signing into an existing account with this
  // number is exactly what the conflict flow wants.
  const conflictFromUid = user && user.is_anonymous === true ? user.id : undefined;
  const { error } = await supabase.auth.signInWithOtp({
    phone: e164,
    options: captchaOptions(captcha.token),
  });
  if (error) {
    if (isRateLimit(error)) {
      return { ok: false, code: "rate_limited", message: RATE_LIMIT_COPY };
    }
    return { ok: false, code: "provider_error", message: error.message };
  }
  return {
    ok: true,
    mode: "sms",
    target: e164,
    resendsLeft: counter.resendsLeft,
    ...(conflictFromUid ? { conflictFromUid } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* 3. Verify OTP (Screen B submit; also /login)                         */
/* ------------------------------------------------------------------ */

const verifyOtpSchema = z.object({
  mode: z.enum(["phone_change", "sms", "email_change", "email"]),
  target: z.string().min(3).max(320),
  code: z.string().regex(/^\d{6}$/),
  /** Orphaned anonymous uid to clean up after a conflict sign-in. */
  conflictFromUid: z.uuid().optional(),
  next: z.string().optional(),
});

export async function verifyOtp(
  input: z.infer<typeof verifyOtpSchema>,
): Promise<AuthActionResult<{ next: string }>> {
  const closed = comingSoonClosed();
  if (closed) return closed;

  const parsed = verifyOtpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid_input", message: "Enter the 6-digit code." };
  }
  const { mode, target, code, conflictFromUid } = parsed.data;

  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return { ok: false, code: "not_configured", message: "Sign-in isn't available yet." };
  }

  const isEmailMode = mode === "email_change" || mode === "email";
  const { error } = await supabase.auth.verifyOtp(
    isEmailMode
      ? { email: target, token: code, type: mode }
      : { phone: target, token: code, type: mode },
  );

  if (error) {
    if (isRateLimit(error)) {
      return { ok: false, code: "rate_limited", message: RATE_LIMIT_COPY };
    }
    if (isOtpInvalid(error)) {
      return {
        ok: false,
        code: "otp_invalid",
        message: "That code didn't match. Check the six digits and try again.",
      };
    }
    return { ok: false, code: "provider_error", message: error.message };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: "provider_error", message: "Verification did not produce a session." };
  }

  const core = tryGetCore();
  if (core) {
    try {
      await ensureCustomerFromAuth(core.db, {
        authUserId: user.id,
        isAnonymous: false,
        phone: isEmailMode ? null : target,
        email: isEmailMode ? target : null,
      });
      if (isEmailMode) {
        await attachEmail(core.db, { authUserId: user.id, email: target, verified: true });
      } else {
        await attachVerifiedPhone(core.db, { authUserId: user.id, phone: target });
      }

      // Phone-conflict flow: the funnel draft belonged to the now-orphaned
      // anonymous user. Move it, then delete the orphan (row + auth user).
      if (conflictFromUid && conflictFromUid !== user.id) {
        await reparentBookingDraft(core.db, {
          fromUserId: conflictFromUid,
          toUserId: user.id,
        });
        const deleted = await deleteAnonymousCustomer(core.db, conflictFromUid);
        if (deleted) {
          try {
            await deleteAuthUser(conflictFromUid);
          } catch (adminError) {
            console.error("[auth] orphaned anonymous auth user not deleted", adminError);
          }
        }
      }

      await syncDraftRow(user.id);
    } catch (dbError) {
      if (dbError instanceof ConflictError) {
        return {
          ok: false,
          code: dbError.field === "phone" ? "PHONE_EXISTS" : "EMAIL_EXISTS",
          message: CONFLICT_COPY,
        };
      }
      // Verification succeeded; profile writes are retried by later steps.
      console.error("[auth] post-verify customer write failed", dbError);
    }
  }

  return { ok: true, next: sanitizeReturnTo(parsed.data.next) ?? "/book/pay" };
}

/* ------------------------------------------------------------------ */
/* 4. Email magic link (returning users, /login secondary path)         */
/* ------------------------------------------------------------------ */

const magicLinkSchema = z.object({
  email: emailField,
  turnstileToken: z.string().nullable(),
  next: z.string().optional(),
});

export async function sendMagicLink(
  input: z.infer<typeof magicLinkSchema>,
): Promise<AuthActionResult<{ email: string }>> {
  const closed = comingSoonClosed();
  if (closed) return closed;

  const parsed = magicLinkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid_input", message: "Enter a valid email address." };
  }

  const captcha = requireCaptchaToken(parsed.data.turnstileToken);
  if (!captcha.ok) return captcha;

  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return { ok: false, code: "not_configured", message: "Sign-in isn't available yet." };
  }

  const hdrs = await headers();
  const origin =
    hdrs.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const next = sanitizeReturnTo(parsed.data.next) ?? "/trips";

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      ...captchaOptions(captcha.token),
    },
  });

  if (error) {
    if (isRateLimit(error)) {
      return { ok: false, code: "rate_limited", message: RATE_LIMIT_COPY };
    }
    // shouldCreateUser: false → unknown email is reported as signups-disabled.
    if (error.code === "otp_disabled" || /signups not allowed/i.test(error.message)) {
      return {
        ok: false,
        code: "provider_error",
        message:
          "We couldn't find that email — try your phone number, or the email you added after booking.",
      };
    }
    return { ok: false, code: "provider_error", message: error.message };
  }

  return { ok: true, email: parsed.data.email };
}

/* ------------------------------------------------------------------ */
/* 5. Post-booking email attach (confirmation screen)                   */
/* ------------------------------------------------------------------ */

const attachEmailSchema = z.object({
  email: emailField,
  bookingId: z.uuid(),
});

export async function attachEmailPostBooking(
  input: z.infer<typeof attachEmailSchema>,
): Promise<AuthActionResult> {
  const closed = comingSoonClosed();
  if (closed) return closed;

  const parsed = attachEmailSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid_input", message: "Enter a valid email address." };
  }
  const email = parsed.data.email;

  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return { ok: false, code: "not_configured", message: "Not available right now." };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: "provider_error", message: "Your session has expired." };
  }

  // Same guarded path as every other `updateUser` send: throttle first,
  // reconcile `email_change` claims, and report an existing account before
  // Supabase sends anything.
  const guard = await guardUpgradeSend({
    userId: user.id,
    destination: email,
    kind: "email",
    conflictMessage: "That email already belongs to another account.",
  });
  if (!guard.ok) return guard;

  // Fire the Supabase confirmation email; never block the screen on it.
  const { error } = await supabase.auth.updateUser({ email });
  if (error && isEmailExists(error)) {
    return {
      ok: false,
      code: "EMAIL_EXISTS",
      message: "That email already belongs to another account.",
    };
  }
  if (error && isRateLimit(error)) {
    return { ok: false, code: "rate_limited", message: RATE_LIMIT_COPY };
  }

  const core = tryGetCore();
  if (core) {
    try {
      await attachEmail(core.db, { authUserId: user.id, email, verified: false });
      await sendBookingConfirmationEmail(core, {
        bookingId: parsed.data.bookingId,
        email,
      });
    } catch (dbError) {
      if (dbError instanceof ConflictError) {
        return {
          ok: false,
          code: "EMAIL_EXISTS",
          message: "That email already belongs to another account.",
        };
      }
      console.error("[auth] attachEmailPostBooking write failed", dbError);
    }
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* 6. Sign out                                                          */
/* ------------------------------------------------------------------ */

export async function signOut(): Promise<void> {
  const supabase = await getSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/");
}

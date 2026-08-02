"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CTAButton, FormMessage, formatUsPhone, Input, Label, OTPInput, PageHeader, PhoneInput, toE164 } from "@koolee/ui";

import {
  sendOtp,
  verifyOtp,
  type OtpMode,
  type SendOtpSuccess,
} from "@/actions/auth";
import { TurnstileWidget } from "@/components/turnstile-widget";

/**
 * Screens A + B of the payment-gate verification, per the auth-flow spec:
 * phone-first with a quiet email escape hatch, invisible Turnstile, 30s resend
 * countdown (3 resends max, server-enforced), conflict flow into sign-in, and
 * straight to /book/pay on success — no interstitial.
 */

type Screen = "contact" | "code";
type Channel = "phone" | "email";

const RESEND_SECONDS = 30;
const MAX_RESENDS = 3;

export function VerifyFlow({
  alreadyVerified,
  hasSession,
}: {
  alreadyVerified: boolean;
  hasSession: boolean;
}) {
  const reduceMotion = useReducedMotion();

  const [screen, setScreen] = React.useState<Screen>("contact");
  const [channel, setChannel] = React.useState<Channel>("phone");
  const [digits, setDigits] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [resendIn, setResendIn] = React.useState(0);
  const [resends, setResends] = React.useState(0);
  const [sent, setSent] = React.useState<SendOtpSuccess | null>(null);
  const [otpKey, setOtpKey] = React.useState(0);
  const [shake, setShake] = React.useState(0);
  const turnstileToken = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  const e164 = toE164(digits);

  const send = async (opts: { intent: "upgrade" | "signin"; isResend?: boolean }) => {
    const target = channel === "phone" ? e164 : email.trim().toLowerCase();
    if (channel === "phone" && !e164) {
      setError("Enter your 10-digit US or Canadian mobile number.");
      return;
    }
    if (channel === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }

    setBusy(true);
    setError(null);

    const result = await sendOtp({
      ...(channel === "phone" ? { phone: target! } : { email: target! }),
      turnstileToken: turnstileToken.current,
      intent: opts.intent,
      isResend: opts.isResend ?? false,
    });
    setBusy(false);

    if (!result.ok) {
      if (result.code === "phone_conflict") {
        setConflict(true);
        setError(result.message);
        return;
      }
      setError(result.message);
      return;
    }

    setSent(result);
    setCode("");
    setOtpKey((k) => k + 1);
    setScreen("code");
    setResendIn(RESEND_SECONDS);
    if (opts.isResend) setResends((n) => n + 1);
  };

  const verify = async (token: string) => {
    if (!sent || token.length !== 6) return;
    setBusy(true);
    setError(null);

    const result = await verifyOtp({
      mode: sent.mode as OtpMode,
      target: sent.target,
      code: token,
      ...(sent.conflictFromUid ? { conflictFromUid: sent.conflictFromUid } : {}),
    });

    if (!result.ok) {
      setBusy(false);
      setCode("");
      setOtpKey((k) => k + 1);
      setShake((s) => s + 1);
      setError(result.message);
      return;
    }

    // Session cookie is set — straight to payment, no interstitial.
    window.location.assign(result.next);
  };

  const slide = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, x: 32 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -32 },
      };

  const heading =
    channel === "phone"
      ? "Where should your driver reach you?"
      : "Where should we send your pickup updates?";

  return (
    <div className="flex flex-col gap-6">
      <AnimatePresence mode="wait" initial={false}>
        {screen === "contact" ? (
          <motion.div
            key="contact"
            {...slide}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-6"
          >
            <PageHeader
              title={heading}
              subtitle={
                channel === "phone" || alreadyVerified ? (
                  <>
                    {channel === "phone" ? (
                      <>Live pickup updates and your tracking link go here by text.</>
                    ) : null}
                    {alreadyVerified ? (
                      <>
                        {" "}
                        You&apos;re verified already — only continue if you want updates
                        on a different {channel === "phone" ? "number" : "email"}.{" "}
                        <Link href="/book/pay" className="underline underline-offset-4">
                          Keep what I have
                        </Link>
                      </>
                    ) : null}
                  </>
                ) : undefined
              }
            />

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send({
                  intent: conflict || (!hasSession && channel === "phone") ? "signin" : "upgrade",
                });
              }}
              className="flex flex-col gap-5"
            >
              {channel === "phone" ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="verify-phone">Phone number</Label>
                  <PhoneInput
                    id="verify-phone"
                    value={digits}
                    onValueChange={(next) => {
                      setDigits(next);
                      setError(null);
                      setConflict(false);
                    }}
                    autoFocus
                    disabled={busy}
                    invalid={Boolean(error) && !conflict}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="verify-email">Email</Label>
                  <Input
                    id="verify-email"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError(null);
                    }}
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoFocus
                    disabled={busy}
                    className="h-12 rounded-lg bg-white px-3.5 text-base"
                  />
                </div>
              )}

              <TurnstileWidget
                onToken={(token) => {
                  turnstileToken.current = token;
                }}
              />

              {error ? <FormMessage variant="error">{error}</FormMessage> : null}

              <CTAButton type="submit" size="lg" className="w-full" loading={busy}>
                {busy
                  ? "Sending…"
                  : conflict
                    ? "Sign in with this number"
                    : channel === "phone"
                      ? "Text me a code"
                      : "Email me a code"}
              </CTAButton>

              <p className="text-xs leading-relaxed text-muted-foreground">
                By continuing you agree to our{" "}
                <Link href="/terms" className="underline underline-offset-4">
                  Terms
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="underline underline-offset-4">
                  Privacy Policy
                </Link>
                . Msg &amp; data rates may apply.
              </p>
            </form>

            {channel === "phone" ? (
              <button
                type="button"
                onClick={() => {
                  setChannel("email");
                  setError(null);
                  setConflict(false);
                }}
                className="self-start text-sm text-navy-600 underline-offset-4 hover:text-navy-800 hover:underline"
              >
                Traveling without a US number? Use email instead
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setChannel("phone");
                  setError(null);
                }}
                className="self-start text-sm text-navy-600 underline-offset-4 hover:text-navy-800 hover:underline"
              >
                Use a phone number instead
              </button>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="code"
            {...slide}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-6"
          >
            <PageHeader
              title={
                channel === "phone"
                  ? "Enter the 6-digit code we texted you"
                  : "Enter the 6-digit code we emailed you"
              }
              subtitle={
                <>
                  Sent to{" "}
                  {channel === "phone" ? formatUsPhone(digits) : email.trim().toLowerCase()}.
                </>
              }
            />

            <motion.div
              key={shake}
              animate={
                shake > 0 && !reduceMotion ? { x: [0, -10, 10, -8, 8, -4, 4, 0] } : {}
              }
              transition={{ duration: 0.45 }}
            >
              <OTPInput
                key={otpKey}
                value={code}
                onChange={(next) => {
                  setCode(next);
                  setError(null);
                }}
                onComplete={(token) => void verify(token)}
                disabled={busy}
                autoFocus
                invalid={Boolean(error)}
              />
            </motion.div>

            {error ? <FormMessage variant="error">{error}</FormMessage> : null}

            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setScreen("contact");
                  setCode("");
                  setError(null);
                }}
                className="text-navy-600 underline-offset-4 hover:text-navy-800 hover:underline"
              >
                {channel === "phone" ? "Change number" : "Change email"}
              </button>
              <button
                type="button"
                onClick={() =>
                  void send({
                    intent: conflict || (!hasSession && channel === "phone") ? "signin" : "upgrade",
                    isResend: true,
                  })
                }
                disabled={busy || resendIn > 0 || resends >= MAX_RESENDS}
                className="text-sky-700 underline-offset-4 hover:text-sky-600 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
              >
                {resendIn > 0 ? `Resend code (${resendIn}s)` : "Resend code"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

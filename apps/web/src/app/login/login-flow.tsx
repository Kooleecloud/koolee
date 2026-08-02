"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CTAButton, formatUsPhone, Label, OTPInput, PhoneInput, toE164 } from "@koolee/ui";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

import { completeSignIn } from "./actions";

/**
 * Two screens, one flow: phone → code. Built to be fully demoable with
 * Supabase test phone numbers today; when Twilio is connected later, nothing
 * here changes.
 */

type Step = "phone" | "code";

const isDev = process.env.NODE_ENV === "development";

/** Missing/broken SMS provider looks different from a bad number — detect it. */
function isProviderConfigIssue(error: { message: string; status?: number }): boolean {
  if ((error.status ?? 0) >= 500) return true;
  return /provider|not.*(configured|enabled)|disabled|unsupported|sms.*(fail|error)|error sending/i.test(
    error.message,
  );
}

export function LoginFlow({ returnTo }: { returnTo: string | null }) {
  const supabase = React.useMemo(() => getSupabaseBrowserClient(), []);
  const reduceMotion = useReducedMotion();

  const [step, setStep] = React.useState<Step>("phone");
  const [digits, setDigits] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [providerIssue, setProviderIssue] = React.useState(false);
  const [resendIn, setResendIn] = React.useState(0);

  React.useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  if (!supabase) {
    return (
      <div className="rounded-xl border border-warning/40 bg-warning/10 p-5 text-sm leading-relaxed text-navy-800">
        <p className="font-medium">Sign-in isn&apos;t available yet.</p>
        <p className="mt-1 text-muted-foreground">
          This environment has no Supabase credentials configured
          {isDev ? (
            <>
              {" "}
              — set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code>.env.local</code>.
            </>
          ) : (
            ". Please try again soon."
          )}
        </p>
      </div>
    );
  }

  const e164 = toE164(digits);

  const sendCode = async () => {
    if (!e164) {
      setError("Enter your 10-digit US phone number.");
      return;
    }
    setBusy(true);
    setError(null);
    setProviderIssue(false);

    const { error: sendError } = await supabase.auth.signInWithOtp({ phone: e164 });
    setBusy(false);

    if (sendError) {
      if (isProviderConfigIssue(sendError)) {
        setProviderIssue(true);
      } else {
        setError(sendError.message);
      }
      return;
    }

    setCode("");
    setStep("code");
    setResendIn(30);
  };

  const verifyCode = async (token: string) => {
    if (!e164 || token.length !== 6) return;
    setBusy(true);
    setError(null);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: e164,
      token,
      type: "sms",
    });

    if (verifyError) {
      setBusy(false);
      setCode("");
      setError("That code didn't match. Check the six digits and try again.");
      return;
    }

    // Session cookie is set; hand over to the server to upsert + redirect.
    // Stay busy until navigation happens.
    await completeSignIn(returnTo ?? undefined);
  };

  const slide = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, x: 32 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -32 },
      };

  return (
    <div className="rounded-2xl border border-border bg-white p-6 shadow-lift sm:p-8">
      <AnimatePresence mode="wait" initial={false}>
        {step === "phone" ? (
          <motion.form
            key="phone"
            {...slide}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode();
            }}
            className="flex flex-col gap-5"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="login-phone">Phone number</Label>
              <PhoneInput
                id="login-phone"
                value={digits}
                onValueChange={(next) => {
                  setDigits(next);
                  setError(null);
                }}
                autoFocus
                disabled={busy}
                invalid={Boolean(error)}
              />
            </div>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            {providerIssue ? (
              <div
                role="alert"
                className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm leading-relaxed text-navy-800"
              >
                <p>
                  We couldn&apos;t text that number right now — our SMS service
                  isn&apos;t reachable. Please try again in a bit.
                </p>
                {isDev ? (
                  <p className="mt-2 text-muted-foreground">
                    Dev hint: the SMS provider isn&apos;t connected. Use a Supabase{" "}
                    <strong>test phone number</strong> (Auth → Providers → Phone) — the
                    whole flow works with it today.
                  </p>
                ) : null}
              </div>
            ) : null}

            <CTAButton type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? "Sending…" : "Text me a code"}
            </CTAButton>
          </motion.form>
        ) : (
          <motion.div
            key="code"
            {...slide}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-5"
          >
            <div className="flex flex-col gap-1.5">
              <h2 className="font-display text-lg font-semibold text-navy-800">
                Check your texts
              </h2>
              <p className="text-sm text-muted-foreground">
                We sent a 6-digit code to {formatUsPhone(digits)}.
              </p>
            </div>

            <OTPInput
              value={code}
              onChange={(next) => {
                setCode(next);
                setError(null);
              }}
              onComplete={(token) => void verifyCode(token)}
              disabled={busy}
              autoFocus
              invalid={Boolean(error)}
            />

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <CTAButton
              type="button"
              size="lg"
              className="w-full"
              disabled={busy || code.length !== 6}
              onClick={() => void verifyCode(code)}
            >
              {busy ? "Verifying…" : "Verify & continue"}
            </CTAButton>

            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setCode("");
                  setError(null);
                }}
                className="text-navy-600 underline-offset-4 hover:text-navy-800 hover:underline"
              >
                Use a different number
              </button>
              <button
                type="button"
                onClick={() => void sendCode()}
                disabled={busy || resendIn > 0}
                className="text-sky-700 underline-offset-4 hover:text-sky-600 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Card,
  CTAButton,
  FormMessage,
  formatUsPhone,
  Input,
  Label,
  OTPInput,
  PhoneInput,
  toE164,
} from "@koolee/ui";

import { type SendOtpSuccess } from "@/actions/auth";
import {
  TurnstileGate,
  type TurnstileGateHandle,
} from "@/components/auth/turnstile-gate";

import { sendOtp, verifyOtp } from "./actions";

/**
 * Returning-user sign-in. Primary: phone → OTP. Secondary: email magic link
 * (existing accounts only). No passwords anywhere; no OAuth in v1.
 */

type Step = "phone" | "code" | "email";

const RESEND_SECONDS = 30;
const MAX_RESENDS = 3;

export function LoginFlow({ returnTo }: { returnTo: string | null }) {
  const reduceMotion = useReducedMotion();

  const [step, setStep] = React.useState<Step>("phone");
  const [digits, setDigits] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resendIn, setResendIn] = React.useState(0);
  const [resends, setResends] = React.useState(0);
  const [sent, setSent] = React.useState<SendOtpSuccess | null>(null);
  const [otpKey, setOtpKey] = React.useState(0);
  const turnstile = React.useRef<TurnstileGateHandle>(null);

  React.useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  const e164 = toE164(digits);

  /** Shared by both channels so the two senders cannot drift apart. */
  const enterCodeStep = (result: SendOtpSuccess, isResend: boolean) => {
    setSent(result);
    setCode("");
    setOtpKey((k) => k + 1);
    setStep("code");
    setResendIn(RESEND_SECONDS);
    if (isResend) setResends((n) => n + 1);
  };

  const sendCode = async (isResend = false) => {
    if (!e164) {
      setError("Enter your 10-digit US phone number.");
      return;
    }
    setBusy(true);
    setError(null);

    // Tokens are single-use: mint a fresh one per send.
    const token = (await turnstile.current?.getToken()) ?? null;

    const result = await sendOtp({
      phone: e164,
      turnstileToken: token,
      intent: "signin",
      isResend,
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    enterCodeStep(result, isResend);
  };

  const verifyCode = async (token: string) => {
    if (!sent || token.length !== 6) return;
    setBusy(true);
    setError(null);

    const result = await verifyOtp({
      mode: sent.mode,
      target: sent.target,
      code: token,
      next: returnTo ?? "/trips",
    });

    if (!result.ok) {
      setBusy(false);
      setCode("");
      setOtpKey((k) => k + 1);
      setError(result.message);
      return;
    }

    // Session cookie is set; stay busy until navigation happens.
    window.location.assign(result.next);
  };

  const sendEmailCode = async (isResend = false) => {
    const address = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);

    const token = (await turnstile.current?.getToken()) ?? null;

    const result = await sendOtp({
      email: address,
      turnstileToken: token,
      intent: "signin",
      isResend,
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    enterCodeStep(result, isResend);
  };

  const viaEmail = sent?.mode === "email" || sent?.mode === "email_change";

  const slide = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, x: 32 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -32 },
      };
  const transition = { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const };

  return (
    <Card surface="panel" className="p-6 sm:p-8">
      {/* Outside AnimatePresence so resends from the code step and the email
          step share one gate that survives screen swaps. */}
      <TurnstileGate ref={turnstile} />

      <AnimatePresence mode="wait" initial={false}>
        {step === "phone" && (
          <motion.form
            key="phone"
            {...slide}
            transition={transition}
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

            {error ? <FormMessage variant="error">{error}</FormMessage> : null}

            <CTAButton type="submit" size="lg" className="w-full" loading={busy}>
              {busy ? "Sending…" : "Text me a code"}
            </CTAButton>

            <button
              type="button"
              onClick={() => {
                setStep("email");
                setError(null);
              }}
              className="self-start text-sm text-navy-600 underline-offset-4 hover:text-navy-800 hover:underline"
            >
              Sign in with email instead
            </button>
          </motion.form>
        )}

        {step === "code" && (
          <motion.div
            key="code"
            {...slide}
            transition={transition}
            className="flex flex-col gap-5"
          >
            <div className="flex flex-col gap-1.5">
              <h2 className="font-display text-lg font-semibold text-navy-800">
                {viaEmail ? "Check your email" : "Check your texts"}
              </h2>
              <p className="text-sm text-muted-foreground">
                We sent a 6-digit code to{" "}
                {viaEmail ? (sent?.target ?? "") : formatUsPhone(digits)}.
              </p>
            </div>

            <OTPInput
              key={otpKey}
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

            {error ? <FormMessage variant="error">{error}</FormMessage> : null}

            <CTAButton
              type="button"
              size="lg"
              className="w-full"
              loading={busy}
              disabled={code.length !== 6}
              onClick={() => void verifyCode(code)}
            >
              {busy ? "Verifying…" : "Verify & continue"}
            </CTAButton>

            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep(viaEmail ? "email" : "phone");
                  setCode("");
                  setError(null);
                }}
                className="text-navy-600 underline-offset-4 hover:text-navy-800 hover:underline"
              >
                {viaEmail ? "Use a different email" : "Use a different number"}
              </button>
              <button
                type="button"
                onClick={() => void (viaEmail ? sendEmailCode(true) : sendCode(true))}
                disabled={busy || resendIn > 0 || resends >= MAX_RESENDS}
                className="text-sky-700 underline-offset-4 hover:text-sky-600 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
              >
                {resendIn > 0 ? `Resend code (${resendIn}s)` : "Resend code"}
              </button>
            </div>
          </motion.div>
        )}

        {step === "email" && (
          <motion.form
            key="email"
            {...slide}
            transition={transition}
            onSubmit={(e) => {
              e.preventDefault();
              void sendEmailCode();
            }}
            className="flex flex-col gap-5"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
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
                className="h-12 rounded-lg bg-card px-3.5 text-base"
              />
            </div>

            {error ? <FormMessage variant="error">{error}</FormMessage> : null}

            <CTAButton type="submit" size="lg" className="w-full" loading={busy}>
              {busy ? "Sending…" : "Email me a code"}
            </CTAButton>

            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setError(null);
              }}
              className="self-start text-sm text-navy-600 underline-offset-4 hover:text-navy-800 hover:underline"
            >
              Use my phone number instead
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </Card>
  );
}

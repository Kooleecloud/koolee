"use client";

import * as React from "react";
import { useActionState } from "react";
import { Button, FormMessage, Input, Label, usePreservedFormValues } from "@koolee/ui";

import {
  confirmEmailCode,
  resendEmailCode,
  type ProfileActionState,
} from "./actions";

/** Same countdown and cap the booking funnel's verification screen uses. */
const RESEND_SECONDS = 30;
const MAX_RESENDS = 3;

/** Enter the 6-digit code from the confirmation email — pending → verified. */
export function ConfirmEmailForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<ProfileActionState, FormData>(
    confirmEmailCode,
    {},
  );
  const { formRef, captureValues } = usePreservedFormValues(state);

  // The resend is a button, not a second form: it posts nothing the client
  // owns (the server reads the pending address off the account), and driving
  // it from a transition keeps the post-send bookkeeping — countdown, cap,
  // clearing the dead code — in the event handler instead of an effect.
  const codeRef = React.useRef<HTMLInputElement>(null);
  const [resendState, setResendState] = React.useState<ProfileActionState>({});
  const [resending, startResend] = React.useTransition();
  const [cooldown, setCooldown] = React.useState(0);
  const [resends, setResends] = React.useState(0);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const resend = () => {
    startResend(async () => {
      const result = await resendEmailCode();
      setResendState(result);
      if (!result.ok) return;

      setCooldown(RESEND_SECONDS);
      setResends((n) => n + 1);
      // The old code is dead now — clear it rather than let the user submit
      // digits they cannot tell are stale.
      if (codeRef.current) {
        codeRef.current.value = "";
        codeRef.current.focus();
      }
    });
  };

  if (state.ok) {
    return <FormMessage variant="success">Email verified.</FormMessage>;
  }

  const capped = resends >= MAX_RESENDS;

  return (
    <div className="flex flex-col gap-2">
      <form
        ref={formRef}
        action={formAction}
        onSubmit={() => {
          captureValues();
          // A confirm attempt supersedes "new code sent" — don't stack banners.
          setResendState({});
        }}
        className="flex flex-col gap-2"
      >
        <input type="hidden" name="email" value={email} />
        <Label htmlFor="email-code">
          We emailed a 6-digit code to {email} — enter it to finish verifying.
        </Label>
        <div className="flex gap-2">
          <Input
            ref={codeRef}
            id="email-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="123456"
            className="w-32 font-mono tracking-widest"
            required
          />
          <Button type="submit" variant="outline" loading={pending}>
            Confirm
          </Button>
        </div>
      </form>

      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto self-start px-0"
        onClick={resend}
        loading={resending}
        disabled={cooldown > 0 || capped}
      >
        {capped
          ? "Resend limit reached"
          : cooldown > 0
            ? `Resend code (${cooldown}s)`
            : "Didn't get it? Resend code"}
      </Button>

      {state.error && <FormMessage>{state.error}</FormMessage>}
      {resendState.error && <FormMessage>{resendState.error}</FormMessage>}
      {resendState.ok && (
        <FormMessage variant="info">
          New code sent to {email}. It can take a minute to arrive — check spam.
        </FormMessage>
      )}
    </div>
  );
}

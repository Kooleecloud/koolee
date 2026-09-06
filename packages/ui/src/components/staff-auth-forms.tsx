"use client";

import * as React from "react";
import { useActionState } from "react";

import { PASSWORD_MIN_LENGTH, PASSWORD_RULE_COPY } from "../lib/credentials";
import { usePreservedFormValues } from "../lib/use-preserved-form";
import { Button } from "./button";
import { FormMessage } from "./form-message";
import { Input } from "./input";
import { Label } from "./label";
import { PasswordField } from "./password-field";
import { Spinner } from "./spinner";

/**
 * Shared staff auth forms for the agent and admin apps. Email + password
 * only — no OTP, no magic links, no OAuth, and deliberately NO signup form:
 * staff accounts exist only through the admin invite flow. Each app passes
 * its own server action; the forms are pure presentation + pending state.
 */

export interface StaffAuthState {
  error?: string;
  ok?: boolean;
}

type StaffAuthAction = (
  state: StaffAuthState,
  formData: FormData,
) => Promise<StaffAuthState>;

function SubmitButton({ children }: { children: React.ReactNode }) {
  return (
    <Button type="submit" className="w-full">
      {children}
    </Button>
  );
}

export function StaffLoginForm({
  action,
  resetHref,
  captchaSlot,
}: {
  action: StaffAuthAction;
  resetHref: string;
  /**
   * Turnstile widget, injected by the app (the site key is app env, and this
   * package reads none). It writes a single-use token into a hidden field the
   * server action forwards to Supabase as `options.captchaToken`. Optional:
   * with no site key the app passes nothing and the form is unchanged.
   */
  captchaSlot?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  // A wrong password must not wipe the email the user typed (React 19
  // resets uncontrolled fields after actions). Password stays cleared.
  const { formRef, captureValues } = usePreservedFormValues(state);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={captureValues}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="staff-email">Email</Label>
        {/* `autoCapitalize`/`autoCorrect` off: a phone keyboard capitalising
            the first letter of an address is the commonest way the value that
            reaches the server differs from the one on the account. The server
            normalizes regardless (`normalizeEmail`) — this stops the field
            LOOKING wrong while it is typed. */}
        <Input
          id="staff-email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          placeholder="you@koolee.cloud"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="staff-password">Password</Label>
        {/* No `minLength` here, deliberately. A sign-in form must accept
            whatever the account's password actually is; enforcing today's
            floor at the door would lock out an older password AND tell an
            attacker what the policy is before they have an account. */}
        <PasswordField
          id="staff-password"
          name="password"
          autoComplete="current-password"
          required
        />
      </div>
      {captchaSlot}
      {state.error ? <FormMessage>{state.error}</FormMessage> : null}
      <SubmitButton>{pending ? <Spinner /> : "Sign in"}</SubmitButton>
      <a
        href={resetHref}
        className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Forgot your password?
      </a>
    </form>
  );
}

export function PasswordResetForm({
  action,
  captchaSlot,
}: {
  action: StaffAuthAction;
  /** See `StaffLoginForm`. `/recover` is captcha-gated the same way. */
  captchaSlot?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const { formRef, captureValues } = usePreservedFormValues(state);

  if (state.ok) {
    return (
      <FormMessage variant="success">
        If that address has an account, a reset link is on its way. Check your inbox.
      </FormMessage>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={captureValues}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-email">Email</Label>
        <Input
          id="reset-email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          placeholder="you@koolee.cloud"
        />
      </div>
      {captchaSlot}
      {state.error ? <FormMessage>{state.error}</FormMessage> : null}
      <SubmitButton>{pending ? <Spinner /> : "Send reset link"}</SubmitButton>
    </form>
  );
}

export function SetPasswordForm({ action }: { action: StaffAuthAction }) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">New password</Label>
        <PasswordField
          id="new-password"
          name="password"
          autoComplete="new-password"
          // Same constant the server schema reads, so the browser and the
          // action cannot disagree about what is acceptable.
          minLength={PASSWORD_MIN_LENGTH}
          required
        />
        <p className="text-xs text-muted-foreground">{PASSWORD_RULE_COPY}</p>
      </div>
      {state.error ? <FormMessage>{state.error}</FormMessage> : null}
      <SubmitButton>{pending ? <Spinner /> : "Set password and continue"}</SubmitButton>
    </form>
  );
}

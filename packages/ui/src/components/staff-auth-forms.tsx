"use client";

import * as React from "react";
import { useActionState } from "react";

import { usePreservedFormValues } from "../lib/use-preserved-form";
import { Button } from "./button";
import { FormMessage } from "./form-message";
import { Input } from "./input";
import { Label } from "./label";
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
}: {
  action: StaffAuthAction;
  resetHref: string;
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
        <Input
          id="staff-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@koolee.cloud"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="staff-password">Password</Label>
        <Input
          id="staff-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
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

export function PasswordResetForm({ action }: { action: StaffAuthAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  const { formRef, captureValues } = usePreservedFormValues(state);

  if (state.ok) {
    return (
      <FormMessage variant="success">
        If that address has an account, a reset link is on its way. Check your
        inbox.
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
          required
          placeholder="you@koolee.cloud"
        />
      </div>
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
        <Input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      {state.error ? <FormMessage>{state.error}</FormMessage> : null}
      <SubmitButton>{pending ? <Spinner /> : "Set password and continue"}</SubmitButton>
    </form>
  );
}

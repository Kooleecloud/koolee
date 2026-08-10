"use client";

import { useActionState } from "react";
import { Button, FormMessage, usePreservedFormValues } from "@koolee/ui";

import type { ActionState } from "@/app/book/actions";

/**
 * Shared wrapper for the booking steps: form state, error display, pending
 * button. Keeps each step page to markup plus a server action. On a failed
 * submission the user's values are preserved, not reset (React 19 resets
 * uncontrolled fields after every action otherwise).
 */
export function StepForm({
  action,
  submitLabel,
  children,
  renderError,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  submitLabel: string;
  children: React.ReactNode;
  /** Lets a step render something richer than a message for certain errors. */
  renderError?: (state: ActionState) => React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const { formRef, captureValues } = usePreservedFormValues(state);

  const custom = renderError?.(state);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={captureValues}
      className="flex flex-col gap-6"
    >
      {children}

      {custom ??
        (state.error ? (
          <FormMessage variant="error">{state.error}</FormMessage>
        ) : null)}

      <Button type="submit" size="lg" loading={pending}>
        {pending ? "Working…" : submitLabel}
      </Button>
    </form>
  );
}

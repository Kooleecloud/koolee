"use client";

import { useActionState } from "react";
import { Button } from "@koolee/ui";

import type { ActionState } from "@/app/book/actions";

/**
 * Shared wrapper for the booking steps: form state, error display, pending
 * button. Keeps each step page to markup plus a server action.
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

  const custom = renderError?.(state);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {children}

      {custom ??
        (state.error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {state.error}
          </p>
        ) : null)}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Working…" : submitLabel}
      </Button>
    </form>
  );
}

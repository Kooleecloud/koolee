"use client";

import { useActionState } from "react";
import { Button, FormMessage, usePreservedFormValues } from "@koolee/ui";

import type { ActionState } from "@/app/book/actions";
import { OutOfAreaCapture } from "@/components/out-of-area-capture";

/**
 * Step form for steps that validate ZIP coverage.
 *
 * Separate from the generic StepForm because an out-of-area ZIP is not an
 * error to shrug at — it swaps the form for a waitlist capture rather than
 * showing a red banner and leaving the customer stuck.
 */
export function CoverageStepForm({
  action,
  retryHref,
  submitLabel = "Continue",
  children,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  /** Where "Try another ZIP" returns to — the step that owns this form. */
  retryHref: string;
  submitLabel?: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const { formRef, captureValues } = usePreservedFormValues(state);

  if (state.outOfCoverageZip) {
    return <OutOfAreaCapture zip={state.outOfCoverageZip} retryHref={retryHref} />;
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={captureValues}
      className="flex flex-col gap-6"
    >
      {children}

      {state.error && <FormMessage variant="error">{state.error}</FormMessage>}

      <Button type="submit" size="lg" loading={pending}>
        {pending ? "Checking coverage…" : submitLabel}
      </Button>
    </form>
  );
}

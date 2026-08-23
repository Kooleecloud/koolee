"use client";

import { useActionState } from "react";
import { Button, FormMessage, usePreservedFormValues } from "@koolee/ui";

import type { ActionState } from "@/app/book/actions";
import { OutOfAreaCapture } from "@/components/out-of-area-capture";

/**
 * Address step.
 *
 * Separate from the generic StepForm because an out-of-area ZIP is not an
 * error to shrug at — it swaps the form for a waitlist capture rather than
 * showing a red banner and leaving the customer stuck.
 */
export function AddressStepForm({
  action,
  children,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const { formRef, captureValues } = usePreservedFormValues(state);

  if (state.outOfCoverageZip) {
    return <OutOfAreaCapture zip={state.outOfCoverageZip} retryHref="/book/address" />;
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
        {pending ? "Checking coverage…" : "Continue"}
      </Button>
    </form>
  );
}

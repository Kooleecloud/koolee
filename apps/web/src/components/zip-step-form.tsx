"use client";

import { useActionState } from "react";
import { Button, FormMessage, Input, Label } from "@koolee/ui";

import { submitZip, type ActionState } from "@/app/book/actions";
import { OutOfAreaCapture } from "@/components/out-of-area-capture";

/** Step 1: ZIP coverage check, swapping to waitlist capture when out of area. */
export function ZipStepForm({ defaultZip }: { defaultZip: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    submitZip,
    {},
  );

  if (state.outOfCoverageZip) {
    return <OutOfAreaCapture zip={state.outOfCoverageZip} retryHref="/book/zip" />;
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="grid gap-2">
        <Label htmlFor="zip">Pickup ZIP code</Label>
        <Input
          id="zip"
          name="zip"
          inputMode="numeric"
          placeholder="10001"
          defaultValue={defaultZip}
          autoComplete="postal-code"
          maxLength={10}
          required
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          We currently cover Manhattan, parts of Brooklyn and Queens, and Jersey City.
        </p>
      </div>

      {state.error && <FormMessage variant="error">{state.error}</FormMessage>}

      <Button type="submit" size="lg" loading={pending}>
        {pending ? "Checking coverage…" : "Check coverage"}
      </Button>
    </form>
  );
}

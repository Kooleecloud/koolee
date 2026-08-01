"use client";

import { useActionState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@koolee/ui";

import { captureOutOfAreaEmail, type ActionState } from "@/app/book/actions";

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

  if (state.outOfCoverageZip) {
    return <OutOfAreaCapture zip={state.outOfCoverageZip} />;
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {children}

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Checking coverage…" : "Continue"}
      </Button>
    </form>
  );
}

function OutOfAreaCapture({ zip }: { zip: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    captureOutOfAreaEmail,
    {},
  );

  if (state.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Thanks — we&apos;ll be in touch</CardTitle>
          <CardDescription>
            We&apos;ll email you when Koolee reaches {zip}.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">We don&apos;t serve {zip} yet</CardTitle>
        <CardDescription>
          Koolee currently covers Manhattan, parts of Brooklyn and Queens, and Jersey
          City. Leave your email and we&apos;ll tell you when that changes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="zip" value={zip} />
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>

          {state.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Notify me"}
            </Button>
            <Button type="button" variant="outline" asChild>
              <a href="/book/address">Try another address</a>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

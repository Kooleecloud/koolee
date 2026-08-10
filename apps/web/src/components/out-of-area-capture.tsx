"use client";

import { useActionState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormMessage,
  Input,
  Label, usePreservedFormValues } from "@koolee/ui";

import { captureOutOfAreaEmail, type ActionState } from "@/app/book/actions";

/**
 * Waitlist capture for a ZIP outside the service area. Swapped in place of the
 * step form — an out-of-area ZIP is a fork in the flow, not a red banner.
 */
export function OutOfAreaCapture({ zip, retryHref }: { zip: string; retryHref: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    captureOutOfAreaEmail,
    {},
  );
  const { formRef, captureValues } = usePreservedFormValues(state);

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
        <form ref={formRef} onSubmit={captureValues} action={formAction} className="flex flex-col gap-4">
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

          {state.error && <FormMessage variant="error">{state.error}</FormMessage>}

          <div className="flex gap-2">
            <Button type="submit" loading={pending}>
              {pending ? "Saving…" : "Notify me"}
            </Button>
            <Button type="button" variant="outline" asChild>
              <a href={retryHref}>Try another ZIP</a>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

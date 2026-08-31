"use client";

import * as React from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormMessage,
  Input,
  Label,
} from "@koolee/ui";

import { attachEmailPostBooking } from "@/actions/auth";

/**
 * Optional inline email capture on the confirmation screen. Skippable,
 * fire-and-forget — attaching the email never blocks or gates anything.
 */
export function ConfirmationEmailCard({ bookingId }: { bookingId: string }) {
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Check your inbox to confirm</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Your confirmation and receipt are on the way to {email.trim().toLowerCase()}.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Want your confirmation and receipt by email?
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            void attachEmailPostBooking({ email: email.trim().toLowerCase(), bookingId })
              .then((result) => {
                if (result.ok) setDone(true);
                else setError(result.message);
              })
              .finally(() => setBusy(false));
          }}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="grid flex-1 gap-2">
            <Label htmlFor="confirmation-email" className="sr-only">
              Email
            </Label>
            <Input
              id="confirmation-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <Button type="submit" loading={busy} disabled={!email.trim()}>
            {busy ? "Sending…" : "Send it"}
          </Button>
        </form>
        {error ? (
          <FormMessage variant="error" className="mt-2">
            {error}
          </FormMessage>
        ) : null}
      </CardContent>
    </Card>
  );
}

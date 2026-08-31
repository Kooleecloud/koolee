"use client";

import * as React from "react";
import * as Sentry from "@sentry/nextjs";
import { Button, EmptyState } from "@koolee/ui";

import { ConsoleMain } from "@/components/console";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Both, deliberately: the console line is in Vercel's logs whatever
    // Sentry is doing, and this boundary is a CLIENT component, so without
    // the capture the only record of a render failure would be a browser
    // console nobody is looking at.
    Sentry.captureException(error);
    console.error(error);
  }, [error]);

  return (
    <ConsoleMain width="narrow">
      <EmptyState
        title="Something went wrong"
        description="An unexpected error occurred. Try again, or come back in a moment."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </ConsoleMain>
  );
}

"use client";

import * as React from "react";
import * as Sentry from "@sentry/nextjs";
import { Button, EmptyState } from "@koolee/ui";

import { AgentMain } from "@/components/shell/agent-main";

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
    <AgentMain>
      <EmptyState
        title="Something went wrong"
        description="Your work is not lost — nothing was submitted. Try again, or check your signal."
        action={
          <Button size="lg" onClick={reset}>
            Try again
          </Button>
        }
      />
    </AgentMain>
  );
}

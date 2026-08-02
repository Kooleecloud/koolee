"use client";

import * as React from "react";
import { AppHeader, Button, ContentColumn, EmptyState } from "@koolee/ui";

/**
 * App-level error boundary: errors keep the brand chrome and offer a retry,
 * instead of escaping to a bare stack screen.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <ContentColumn>
        <EmptyState
          title="Something went wrong"
          description="An unexpected error occurred. Your data is safe — try again, or come back in a moment."
          action={<Button onClick={reset}>Try again</Button>}
        />
      </ContentColumn>
    </div>
  );
}

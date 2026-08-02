"use client";

import * as React from "react";
import { Button, ContentColumn, EmptyState } from "@koolee/ui";

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
    <ContentColumn>
      <EmptyState
        title="Something went wrong"
        description="An unexpected error occurred. Try again, or come back in a moment."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </ContentColumn>
  );
}

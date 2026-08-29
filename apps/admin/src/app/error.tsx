"use client";

import * as React from "react";
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

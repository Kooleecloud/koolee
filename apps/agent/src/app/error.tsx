"use client";

import * as React from "react";
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

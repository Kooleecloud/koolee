import Link from "next/link";
import { Button, EmptyState } from "@koolee/ui";

import { AgentMain } from "@/components/shell/agent-main";

export default function NotFound() {
  return (
    <AgentMain>
      <EmptyState
        title="Not found"
        description="This job isn't assigned to you, or it has moved."
        action={
          <Button asChild size="lg">
            <Link href="/">Back to today</Link>
          </Button>
        }
      />
    </AgentMain>
  );
}

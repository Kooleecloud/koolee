import Link from "next/link";
import { Button, ContentColumn, PageHeader } from "@koolee/ui";

import { EnvStatus } from "@/components/env-status";

export default function AgentHomePage() {
  return (
    <ContentColumn width="narrow">
      <PageHeader
        title="Agent console"
        subtitle={
          <>
            Verify, seal, and photograph bags, then hand off for delivery to the
            airline&apos;s bag drop.
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <Button asChild size="lg">
          <Link href="/tasks">My tasks</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/scan">Scan</Link>
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link href="/login">Dev sign-in</Link>
        </Button>
      </div>

      <EnvStatus appName="agent" />
    </ContentColumn>
  );
}

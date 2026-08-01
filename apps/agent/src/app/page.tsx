import Link from "next/link";
import { Button, KooleeLogo } from "@koolee/ui";

import { EnvStatus } from "@/components/env-status";

export default function AgentHomePage() {
  return (
    <main className="container flex max-w-md flex-col gap-8 py-10">
      <header className="flex flex-col gap-3">
        <KooleeLogo />
        <h1 className="text-2xl font-semibold tracking-tight">Agent console</h1>
        <p className="text-sm text-muted-foreground">
          Verify, seal, and photograph bags, then hand off for delivery to the
          airline&apos;s bag drop.
        </p>
      </header>

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
    </main>
  );
}

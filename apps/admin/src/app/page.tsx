import Link from "next/link";
import { Button } from "@koolee/ui";

import { EnvStatus } from "@/components/env-status";

export default function AdminHomePage() {
  return (
    <main className="container flex max-w-3xl flex-col gap-8 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Operations console</h1>
        <p className="text-sm text-muted-foreground">
          Routes, exceptions, and manual state overrides.
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/bookings">Bookings</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/exceptions">Exceptions</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/login">Dev sign-in</Link>
        </Button>
      </div>

      <EnvStatus appName="admin" />
    </main>
  );
}

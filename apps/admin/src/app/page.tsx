import Link from "next/link";
import { Button, ContentColumn, PageHeader } from "@koolee/ui";

import { EnvStatus } from "@/components/env-status";

export default function AdminHomePage() {
  return (
    <ContentColumn>
      <PageHeader
        title="Operations console"
        subtitle="Routes, exceptions, and manual state overrides."
      />

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
    </ContentColumn>
  );
}

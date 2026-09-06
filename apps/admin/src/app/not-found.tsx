import Link from "next/link";
import { Button, EmptyState } from "@koolee/ui";

import { ConsoleMain } from "@/components/console";

export default function NotFound() {
  return (
    <ConsoleMain width="narrow">
      <EmptyState
        title="Page not found"
        description="This page doesn't exist or may have moved."
        action={
          <Button asChild>
            <Link href="/">Back to overview</Link>
          </Button>
        }
      />
    </ConsoleMain>
  );
}

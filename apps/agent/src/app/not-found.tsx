import Link from "next/link";
import { Button, ContentColumn, EmptyState } from "@koolee/ui";

export default function NotFound() {
  return (
    <ContentColumn width="narrow">
      <EmptyState
        title="Page not found"
        description="This page doesn't exist or may have moved."
        action={
          <Button asChild>
            <Link href="/">Back to home</Link>
          </Button>
        }
      />
    </ContentColumn>
  );
}

import Link from "next/link";
import { AppHeader, ContentColumn, CTAButton, EmptyState } from "@koolee/ui";

export default function NotFound() {
  return (
    <div className="min-h-dvh">
      <AppHeader linkComponent={Link} />
      <ContentColumn>
        <EmptyState
          title="Page not found"
          description="The page you're looking for doesn't exist or may have moved."
          action={
            <CTAButton asChild>
              <Link href="/">Back to home</Link>
            </CTAButton>
          }
        />
      </ContentColumn>
    </div>
  );
}

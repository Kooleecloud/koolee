import Link from "next/link";
import { AppHeader, Button, ContentColumn } from "@koolee/ui";

import { signOut } from "@/actions/auth";
import { SignOutButton } from "@/components/sign-out-button";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <AppHeader
        linkComponent={Link}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/trips">My Trips</Link>
            </Button>
            <form action={signOut}>
              <SignOutButton />
            </form>
          </>
        }
      />
      <ContentColumn>{children}</ContentColumn>
    </div>
  );
}

import Link from "next/link";
import { AppHeader, ContentColumn } from "@koolee/ui";

import { signOut } from "@/actions/auth";
import { SignOutButton } from "@/components/sign-out-button";

/** Navigation shell for the logged-in account area. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <AppHeader
        linkComponent={Link}
        links={[
          { href: "/dashboard/profile", label: "Profile" },
          { href: "/dashboard/addresses", label: "Addresses" },
          { href: "/trips", label: "Trips" },
        ]}
        actions={
          <form action={signOut}>
            <SignOutButton />
          </form>
        }
      />
      <ContentColumn>{children}</ContentColumn>
    </div>
  );
}

import Link from "next/link";
import { AppFooter, AppHeader, Button, ContentColumn } from "@koolee/ui";

import { BookingStepper } from "@/components/booking-stepper";
import { ContactEmailLink } from "@/components/contact-email-link";

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <AppHeader
        linkComponent={Link}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/trips">My Trips</Link>
          </Button>
        }
      />

      <BookingStepper />

      <ContentColumn>{children}</ContentColumn>

      <AppFooter>
        Every pickup is ID-verified, sealed with a serialized tag, and photographed at
        each hand-off. Questions?{" "}
        <ContactEmailLink />
      </AppFooter>
    </div>
  );
}

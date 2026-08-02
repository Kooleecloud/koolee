import Link from "next/link";
import { AppFooter, AppHeader, Button, ContentColumn } from "@koolee/ui";

import { BookingStepper } from "@/components/booking-stepper";

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
        <a
          href="mailto:hello@koolee.nyc"
          className="text-sky-700 underline underline-offset-4 hover:text-sky-600"
        >
          hello@koolee.nyc
        </a>
      </AppFooter>
    </div>
  );
}

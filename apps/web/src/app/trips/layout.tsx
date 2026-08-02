import Link from "next/link";
import { AppHeader, ContentColumn, CTAButton } from "@koolee/ui";

/**
 * Shared chrome for /trips and /trips/[bookingId]. Header lives here (not in
 * pages) so loading.tsx keeps live chrome during the DB round-trip.
 */
export default function TripsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <AppHeader
        linkComponent={Link}
        actions={
          <CTAButton size="sm" asChild>
            <Link href="/book/zip">Book a pickup</Link>
          </CTAButton>
        }
      />
      <ContentColumn>{children}</ContentColumn>
    </div>
  );
}

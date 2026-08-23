import Link from "next/link";
import { Badge, CTAButton, PageHeader } from "@koolee/ui";

/**
 * Rendered in place of the OTP flow while NEXT_PUBLIC_LAUNCH_MODE=coming_soon:
 * the funnel is fully browsable up to this step, then stops here instead of
 * creating an account. The server actions are independently closed
 * (`comingSoonClosed` in actions/auth.ts) — this panel is UX, not the gate.
 */
export function ComingSoonPanel() {
  return (
    <div className="flex flex-col gap-6">
      <Badge variant="secondary" className="self-start">
        Coming soon
      </Badge>
      <PageHeader
        title="Booking opens soon"
        subtitle="You've seen the whole flow — accounts and payment just aren't switched on yet. We're putting the final touches on pickups, and this step will light up the day we launch."
      />
      <CTAButton asChild className="self-start">
        <Link href="/">Back to home</Link>
      </CTAButton>
    </div>
  );
}

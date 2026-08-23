import { CircleCheck, CircleHelp } from "lucide-react";

import { cn } from "../lib/utils";

export interface VerifiedIndicatorProps {
  verified: boolean;
  /** What is being described, e.g. "Phone". Used for the accessible label. */
  subject: string;
  className?: string;
}

/**
 * Verified / not-verified state for one contact channel.
 *
 * The icon carries the meaning visually and an sr-only phrase carries it for
 * assistive tech — colour alone is never the signal. Replaces the previous
 * "verified 21 minutes ago" copy, where the elapsed time was noise: what
 * matters is whether the channel is usable, not when it became so.
 */
function VerifiedIndicator({ verified, subject, className }: VerifiedIndicatorProps) {
  const Icon = verified ? CircleCheck : CircleHelp;
  return (
    <span className={cn("inline-flex items-center", className)}>
      <Icon
        aria-hidden
        className={cn("size-4 shrink-0", verified ? "text-success" : "text-warning")}
      />
      <span className="sr-only">
        {subject} {verified ? "is verified" : "is not verified yet"}
      </span>
    </span>
  );
}

export { VerifiedIndicator };

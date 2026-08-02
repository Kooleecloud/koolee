import * as React from "react";
import { ChevronLeft } from "lucide-react";

import { Button } from "./button";

export interface BackLinkProps {
  href: string;
  children: React.ReactNode;
  /** Link element for client-side navigation (pass Next.js `Link`). */
  linkComponent?: React.ElementType;
  className?: string;
}

/** Standard "go up one level" affordance: ghost button, leading chevron. */
function BackLink({
  href,
  children,
  linkComponent: LinkComponent = "a",
  className,
}: BackLinkProps) {
  return (
    <Button asChild variant="ghost" size="sm" className={className}>
      <LinkComponent href={href}>
        <ChevronLeft aria-hidden="true" />
        {children}
      </LinkComponent>
    </Button>
  );
}

export { BackLink };

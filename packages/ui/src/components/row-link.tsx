import * as React from "react";

import { cn } from "../lib/utils";

/**
 * The real anchor inside a `LinkedTableRow` — what the row forwards its
 * clicks to, and what the keyboard actually reaches.
 *
 * Deliberately NOT in `linked-table-row.tsx`: that file is `"use client"`,
 * and a server component passing `linkComponent={Link}` across a client
 * boundary fails at render with "Functions cannot be passed directly to
 * Client Components" (see the `AppHeader` split for the same reason). This
 * component has no interactivity of its own, so it stays server-renderable
 * and can take the app's `Link`.
 */
export interface RowLinkProps {
  href: string;
  children: React.ReactNode;
  /** The app's router-aware Link (Next's `Link`); defaults to a plain `<a>`. */
  linkComponent?: React.ElementType;
  className?: string;
}

function RowLink({ href, children, linkComponent, className }: RowLinkProps) {
  const Component = linkComponent ?? "a";
  return (
    <Component
      href={href}
      data-row-link=""
      className={cn(
        "font-medium underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </Component>
  );
}

export { RowLink };

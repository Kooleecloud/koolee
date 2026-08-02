"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * Client-boundary wrapper for `next/link`.
 *
 * Next 16's `Link` is no longer itself a client reference, so passing it
 * directly from a Server Component (the marketing layout) into client
 * components like `MarketingNav` fails RSC serialization. A component defined
 * inside a `"use client"` module crosses the boundary as a reference.
 */
export function ClientLink(props: ComponentProps<typeof Link>) {
  return <Link {...props} />;
}

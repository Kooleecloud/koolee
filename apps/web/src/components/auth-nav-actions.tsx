"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, CTAButton } from "@koolee/ui";

import { isComingSoon } from "@/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Session-aware navbar actions. Server-renders the signed-out state ("Get
 * Started") so marketing pages stay static; after hydration it swaps to
 * "My Trips" + sign-out when a Supabase session exists.
 */
export function AuthNavActions() {
  const router = useRouter();
  const [signedIn, setSignedIn] = React.useState(false);

  React.useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSignedIn(Boolean(data.session));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // Pre-launch: no session can exist (OTP actions are closed), so render the
  // signed-out actions with sign-in disabled and tagged.
  if (isComingSoon()) {
    return (
      <>
        <span
          aria-disabled="true"
          className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-navy-600/60"
        >
          My bookings
          <Badge variant="secondary">Coming soon</Badge>
        </span>
        <CTAButton asChild>
          <Link href="/book">Book a pickup</Link>
        </CTAButton>
      </>
    );
  }

  if (!signedIn) {
    return (
      <>
        <Link
          href="/login"
          className="rounded-md px-3 py-2 text-sm font-medium text-navy-600 transition-colors hover:bg-navy-50 hover:text-navy-900 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          My bookings
        </Link>
        <CTAButton asChild>
          <Link href="/book">Book a pickup</Link>
        </CTAButton>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={async () => {
          await getSupabaseBrowserClient()?.auth.signOut();
          router.refresh();
        }}
        className="rounded-md px-3 py-2 text-sm font-medium text-navy-600 transition-colors hover:bg-navy-50 hover:text-navy-900 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        Sign out
      </button>
      <CTAButton asChild>
        <Link href="/trips">My Trips</Link>
      </CTAButton>
    </>
  );
}

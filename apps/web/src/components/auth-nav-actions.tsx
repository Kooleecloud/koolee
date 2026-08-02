"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CTAButton } from "@koolee/ui";

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
          <Link href="/book/zip">Book a pickup</Link>
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

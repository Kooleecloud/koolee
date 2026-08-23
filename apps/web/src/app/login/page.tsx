import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader, PageHeader } from "@koolee/ui";

import { isComingSoon } from "@/env";
import { sanitizeReturnTo } from "@/lib/return-to";
import { getCustomerSession } from "@/lib/session";

import { LoginFlow } from "./login-flow";

export const metadata: Metadata = {
  title: "Welcome back",
  description:
    "Sign in to Koolee with your phone number to book a doorstep luggage pickup, delivered to your airline's bag drop at JFK, LGA, or EWR.",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  // The proxy already bounces /login pre-launch; this covers direct renders.
  if (isComingSoon()) redirect("/");

  const params = await searchParams;
  const returnTo = sanitizeReturnTo(params.returnTo);

  const session = await getCustomerSession();
  if (session) redirect(returnTo ?? "/trips");

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader linkComponent={Link} sticky={false} />

      <main className="flex flex-1 items-start justify-center px-6 pb-20 pt-8 sm:items-center sm:pt-0">
        <div className="flex w-full max-w-md flex-col gap-8">
          <PageHeader
            title="Welcome back"
            subtitle="Sign in with your phone number. No passwords, just a code we text you."
          />

          <LoginFlow returnTo={returnTo} />

          <p className="text-xs leading-relaxed text-muted-foreground">
            We use your number for sign-in and trip updates only. By continuing you
            agree to our{" "}
            <Link href="/terms" className="underline underline-offset-4 hover:text-navy-700">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline underline-offset-4 hover:text-navy-700">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}

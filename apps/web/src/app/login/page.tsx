import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KooleeLogo } from "@koolee/ui";

import { sanitizeReturnTo } from "@/lib/return-to";
import { getCustomerSession } from "@/lib/session";

import { LoginFlow } from "./login-flow";

export const metadata: Metadata = {
  title: "Get Started",
  description:
    "Sign in to Koolee with your phone number to book a doorstep luggage pickup, delivered to your airline's bag drop at JFK, LGA, or EWR.",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const params = await searchParams;
  const returnTo = sanitizeReturnTo(params.returnTo);

  const session = await getCustomerSession();
  if (session) redirect(returnTo ?? "/trips");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="container flex h-16 items-center">
        <Link
          href="/"
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <KooleeLogo />
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 pb-20 pt-8 sm:items-center sm:pt-0">
        <div className="flex w-full max-w-md flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-display-sm font-semibold text-navy-800">
              Let&apos;s get you packing lighter.
            </h1>
            <p className="text-muted-foreground">
              Sign in — or create your account — with your phone number. No passwords,
              just a code we text you.
            </p>
          </div>

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

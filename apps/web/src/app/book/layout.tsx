import Link from "next/link";
import { Button, KooleeLogo } from "@koolee/ui";

import { BookingStepper } from "@/components/booking-stepper";

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b bg-white">
        <div className="container flex h-16 max-w-2xl items-center justify-between">
          <Link
            href="/"
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <KooleeLogo />
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link href="/trips">My Trips</Link>
          </Button>
        </div>
      </header>

      <BookingStepper />

      <main className="container max-w-2xl py-10">{children}</main>

      <footer className="container max-w-2xl pb-10">
        <p className="border-t border-border pt-6 text-xs leading-relaxed text-muted-foreground">
          Every pickup is ID-verified, sealed with a serialized tag, and photographed at
          each hand-off. Questions?{" "}
          <a
            href="mailto:hello@koolee.nyc"
            className="text-sky-700 underline underline-offset-4 hover:text-sky-600"
          >
            hello@koolee.nyc
          </a>
        </p>
      </footer>
    </div>
  );
}

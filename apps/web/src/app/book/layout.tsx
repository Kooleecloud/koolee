import Link from "next/link";
import { KooleeLogo } from "@koolee/ui";

const STEPS = [
  { href: "/book/flight", label: "Flight" },
  { href: "/book/address", label: "Address" },
  { href: "/book/bags", label: "Bags" },
  { href: "/book/slot", label: "Pickup" },
  { href: "/book/pay", label: "Pay" },
] as const;

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b">
        <div className="container flex h-14 max-w-2xl items-center">
          <Link href="/">
            <KooleeLogo />
          </Link>
        </div>
      </header>

      <nav className="border-b bg-muted/40">
        <ol className="container flex max-w-2xl items-center gap-1 overflow-x-auto py-3 text-xs">
          {STEPS.map((step, i) => (
            <li key={step.href} className="flex items-center gap-1 whitespace-nowrap">
              {i > 0 && <span className="text-muted-foreground/50">›</span>}
              <span className="text-muted-foreground">
                {i + 1}. {step.label}
              </span>
            </li>
          ))}
        </ol>
      </nav>

      <main className="container max-w-2xl py-8">{children}</main>
    </div>
  );
}

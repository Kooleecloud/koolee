"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { Badge } from "@koolee/ui";
import { Bug, X } from "lucide-react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Client half of the dev panel: a floating toggle (bottom-left, opposite the
 * Toaster) that opens a right-side drawer of live diagnostics — auth/session
 * state, current route, and the server-rendered Environment card.
 *
 * To add a diagnostic, drop another <DevSection> into the drawer body.
 */
export function DevPanelClient({ envSection }: { envSection: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = React.useState(false);
  const [session, setSession] = React.useState<Session | null>(null);
  const [now, setNow] = React.useState(() => Date.now());

  const supabase = getSupabaseBrowserClient();

  React.useEffect(() => {
    if (!supabase) return;

    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  // Tick the clock only while the drawer is open, for the live durations.
  React.useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  const toggle = () => {
    setNow(Date.now());
    setOpen((v) => !v);
  };

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const user = session?.user ?? null;
  const expiresAtMs = session?.expires_at ? session.expires_at * 1000 : null;
  const sessionLive = expiresAtMs !== null && expiresAtMs > now;
  const signedInAtMs = user?.last_sign_in_at
    ? new Date(user.last_sign_in_at).getTime()
    : null;

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={open ? "Close dev panel" : "Open dev panel"}
        aria-expanded={open}
        className="fixed bottom-4 left-4 z-99 flex size-11 items-center justify-center rounded-full bg-navy-900 text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bug aria-hidden="true" className="size-5" />
      </button>

      {open && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-100 bg-navy-900/20"
          />
          <aside
            role="dialog"
            aria-label="Dev panel"
            className="fixed inset-y-0 right-0 z-101 flex w-90 max-w-[calc(100vw-3rem)] flex-col border-l bg-white shadow-2xl"
          >
            <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Dev panel</span>
                <Badge variant="secondary">{process.env.NODE_ENV}</Badge>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close dev panel"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-navy-50 hover:text-navy-900 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <DevSection title="Session">
                {!supabase ? (
                  <p className="text-sm text-muted-foreground">
                    Supabase not configured — no session data.
                  </p>
                ) : !session || !user ? (
                  <Row label="Status" value={<Badge variant="outline">signed out</Badge>} />
                ) : (
                  <>
                    <Row
                      label="Status"
                      value={
                        <Badge variant={sessionLive ? "success" : "outline"}>
                          {sessionLive ? "live" : "expired"}
                        </Badge>
                      }
                    />
                    <Row label="User ID" value={user.id} mono />
                    {user.phone && <Row label="Phone" value={user.phone} mono />}
                    {user.email && <Row label="Email" value={user.email} mono />}
                    <Row label="Anonymous" value={user.is_anonymous ? "yes" : "no"} />
                    <Row
                      label="Provider"
                      value={user.app_metadata?.provider ?? "unknown"}
                    />
                    {signedInAtMs !== null && (
                      <>
                        <Row
                          label="Signed in at"
                          value={new Date(signedInAtMs).toLocaleTimeString()}
                        />
                        <Row label="Active for" value={formatDuration(now - signedInAtMs)} />
                      </>
                    )}
                    {expiresAtMs !== null && (
                      <Row
                        label="Token refresh in"
                        value={formatDuration(expiresAtMs - now)}
                      />
                    )}
                  </>
                )}
              </DevSection>

              <DevSection title="Route">
                <Row label="Path" value={pathname} mono />
                <Row label="Query" value={searchParams.toString() || "—"} mono />
              </DevSection>

              {envSection}
            </div>
          </aside>
        </>
      )}
    </>
  );
}

function DevSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-3">
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={mono ? "truncate font-mono text-xs" : "truncate"}
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

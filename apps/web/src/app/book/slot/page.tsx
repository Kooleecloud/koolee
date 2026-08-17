import Link from "next/link";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormMessage,
  PageHeader,
} from "@koolee/ui";
import {
  airportLocalDay,
  CutoffUnknownError,
  formatDayInAirportTz,
  formatHourInAirportTz,
  listBookableWindows,
  type PricedWindow,
} from "@koolee/core";

import { redirect } from "next/navigation";

import { startOverBooking, submitSlot } from "@/app/book/actions";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { StepForm } from "@/components/step-form";
import { readDraft } from "@/lib/booking-draft";
import { nextIncompleteStep, stepIsUnlocked } from "@/lib/booking-steps";
import { tryGetCore } from "@/lib/core";

export const metadata = { title: "Pickup window" };
export const dynamic = "force-dynamic";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Step 3 — the pickup-window picker.
 *
 * Windows are virtual: every flight gets the same clock-aligned one-hour
 * windows ending between 30 and 6 hours before departure. There is no
 * capacity — what varies per window is the PRICE, quoted through the real
 * pricing engine (windows closer to departure cost more), and the price
 * shown here is exactly what the pay step charges.
 *
 * Deliberately simple: one sentence of "why these hours", then a two-column
 * grid of bookable windows. Unbookable windows are not rendered at all — a
 * greyed-out graveyard only invites questions the customer cannot act on.
 */
export default async function SlotStepPage() {
  const draft = await readDraft();

  // Locked until flight + pickup are complete; also covers the fields the
  // window query needs (airport, airline, departure time, bags).
  if (
    !stepIsUnlocked(draft, "/book/slot") ||
    !draft.departureAirport ||
    !draft.departureAt ||
    !draft.airlineIata ||
    !draft.bagCount
  ) {
    redirect(nextIncompleteStep(draft));
  }

  const core = tryGetCore();
  if (!core) return <NoDatabase />;

  let windows: PricedWindow[] = [];
  let tz = "America/New_York";
  let loadError: string | null = null;

  try {
    const result = await listBookableWindows(core, {
      airportCode: draft.departureAirport,
      airlineIata: draft.airlineIata,
      scope: draft.scope ?? "domestic",
      departureAt: new Date(draft.departureAt),
      bagCount: draft.bagCount,
      // TODO(maps): real door-to-airport distance via the Maps API.
      distanceKm: 20,
      promoCode: draft.promoCode ?? null,
    });
    windows = result.windows;
    tz = result.tz;
  } catch (error: unknown) {
    // Refusing to sell without a cutoff on record is a customer-facing
    // outcome; anything else is infrastructure and its message (raw SQL,
    // driver detail) must not reach the page.
    if (error instanceof CutoffUnknownError) {
      loadError =
        `We don't have a confirmed bag-drop cutoff for ${draft.airlineIata} at ` +
        `${draft.departureAirport} yet, so we can't sell a pickup for this flight.`;
    } else {
      console.error("[book/slot] failed to load pickup windows", error);
      loadError = "We couldn't load pickup windows just now. Refresh to try again.";
    }
  }

  // Group by airport-local day so the windows read as a calendar, not a
  // wall. Insertion order is chronological because the windows are.
  const byDay = new Map<string, PricedWindow[]>();
  for (const window of windows) {
    const day = airportLocalDay(window.windowStart, tz);
    byDay.set(day, [...(byDay.get(day) ?? []), window]);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pickup window"
        subtitle={
          <>
            We pick up between 30 and 6 hours before your flight — the last 6 hours
            are for getting your bags to {draft.departureAirport}. Earlier windows
            cost less.
          </>
        }
      />

      {loadError && (
        <>
          <FormMessage variant="error">{loadError}</FormMessage>
          <DeadEndActions />
        </>
      )}

      {!loadError && windows.length === 0 ? (
        <NoWindows />
      ) : !loadError ? (
        <StepForm action={submitSlot} submitLabel="Continue">
          <fieldset className="flex flex-col gap-5">
            <legend className="sr-only">Available pickup windows</legend>
            {/*
              The zone is stated once, here, instead of on every tile: 24 tiles
              repeating "EDT" is noise, and every window on this page shares the
              airport's zone by construction.
            */}
            <p className="text-sm text-muted-foreground">
              All times are in local time.
            </p>
            {[...byDay.entries()].map(([day, dayWindows]) => (
              <div key={day} className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-muted-foreground">
                  {formatDayInAirportTz(dayWindows[0]!.windowStart, tz)}
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {dayWindows.map((window) => (
                    <label
                      key={window.windowStart.toISOString()}
                      className="flex cursor-pointer flex-col items-center gap-0.5 rounded-lg border border-border bg-white p-3 text-center shadow-lift transition-all duration-300 hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-lift-lg has-checked:border-primary has-checked:bg-primary/5 has-checked:shadow-lift-lg has-checked:ring-1 has-checked:ring-primary has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                    >
                      <input
                        type="radio"
                        name="windowStart"
                        value={window.windowStart.toISOString()}
                        defaultChecked={
                          draft.windowStart === window.windowStart.toISOString()
                        }
                        className="sr-only"
                        required
                      />
                      {/*
                        Same family and weight for both lines — the customer is
                        trading time against price, so neither should read as a
                        caption of the other. The time is a step larger only
                        because it is what they scan the grid for.
                      */}
                      <span className="font-display text-base font-semibold text-navy-800">
                        {formatHourInAirportTz(window.windowStart, tz)}
                      </span>
                      <span className="font-display text-sm font-semibold text-navy-800">
                        {dollars(window.totalCents)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
        </StepForm>
      ) : null}
    </div>
  );
}

/** The escape hatches every dead end shares. */
function DeadEndActions() {
  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="outline">
        <Link href="/book/flight">Change flight</Link>
      </Button>
      <ConfirmActionForm
        action={startOverBooking}
        title="Start over?"
        description="This clears your booking so far — flight, pickup address, and window are all discarded."
        confirmLabel="Start over"
      >
        <Button type="button" variant="ghost">
          Start over
        </Button>
      </ConfirmActionForm>
    </div>
  );
}

/**
 * Nothing bookable — the flight is too close (inside ~8 hours nothing clears
 * both the 6-hour reserve and the 2-hour booking notice), or ops has blocked
 * what little remained.
 */
function NoWindows() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">No windows can make that flight</CardTitle>
        <CardDescription>
          Pickups need to finish 6 hours before departure and start at least 2 hours
          from now — for this flight, no window fits both. We will not sell a pickup
          that cannot make it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DeadEndActions />
      </CardContent>
    </Card>
  );
}

function NoDatabase() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Database not configured</CardTitle>
        <CardDescription>
          Set <code>DATABASE_URL</code> in <code>.env.local</code>, then run{" "}
          <code>pnpm db:migrate &amp;&amp; pnpm seed</code>. See the README quickstart.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

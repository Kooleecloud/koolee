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
  resolveQuoteDistanceKm,
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
    // The same distance the review page and `createBooking` will resolve —
    // one function, so the three moments a booking is priced cannot disagree.
    const distance = await resolveQuoteDistanceKm(core, {
      airportCode: draft.departureAirport,
      zip: draft.zip,
    });

    const result = await listBookableWindows(core, {
      airportCode: draft.departureAirport,
      airlineIata: draft.airlineIata,
      scope: draft.scope ?? "domestic",
      departureAt: new Date(draft.departureAt),
      bagCount: draft.bagCount,
      distanceKm: distance.km,
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
            We pick up between 30 and 6 hours before your flight — the last 6 hours are
            for getting your bags to {draft.departureAirport}. Earlier windows cost less.
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
            <p className="text-sm text-muted-foreground">All times are in local time.</p>
            {[...byDay.entries()].map(([day, dayWindows]) => (
              <div key={day} className="flex flex-col gap-3">
                {/*
                  The day is the thing you navigate by — 24 tiles under a
                  muted grey caption made the grid read as one undifferentiated
                  wall. Navy at semibold is the same weight the rest of the
                  funnel gives a heading.
                */}
                <h3 className="font-display text-sm font-semibold text-navy-800">
                  {formatDayInAirportTz(dayWindows[0]!.windowStart, tz)}
                </h3>
                {/*
                  Two up on a phone, three on anything wider. Two columns on a
                  laptop left half the row empty and made a 24-window day
                  twelve rows of scrolling.
                */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {dayWindows.map((window) => (
                    <Card asChild interactive key={window.windowStart.toISOString()}>
                      {/*
                        SELECTED IS A PRESSED TILE. It used to be a hairline
                        primary ring on a 5%-tint background, which at a glance
                        across 24 tiles was almost invisible. Now: sky-100
                        ground, a sky-400 border, navy text, and an INSET
                        shadow — pressed in rather than lifted, which is the
                        one shadow direction that reads as "this one is
                        chosen" instead of "this one is hovered".
                      */}
                      <label className="flex cursor-pointer items-center justify-center gap-1.5 p-3 text-center transition-all has-checked:border-sky-400 has-checked:bg-sky-100 has-checked:shadow-[inset_0_2px_4px_0_rgb(2_132_199_/_0.18)] has-checked:ring-1 has-checked:ring-sky-300 has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2">
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
                          One line, `{time} · {price}`. Stacked, the price read
                          as a caption of the time; side by side they are the
                          two halves of the same trade, which is what the
                          customer is actually making.
                        */}
                        <span className="font-display text-sm font-semibold text-navy-800">
                          {formatHourInAirportTz(window.windowStart, tz)}
                        </span>
                        <span aria-hidden className="text-navy-400">
                          ·
                        </span>
                        <span className="font-display text-sm font-semibold text-navy-800">
                          {dollars(window.totalCents)}
                        </span>
                      </label>
                    </Card>
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
          Pickups need to finish 6 hours before departure and start at least 2 hours from
          now — for this flight, no window fits both. We will not sell a pickup that
          cannot make it.
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

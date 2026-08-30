"use client";

import * as React from "react";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormMessage,
} from "@koolee/ui";

import {
  selectDriverAction,
  type SelectDriverState,
} from "@/app/trips/[bookingId]/actions";
import { PICKUP_STEPS } from "@/lib/pickup-progress";

/**
 * The customer's driver: choosing one, then watching them come.
 *
 * Three states, in the order a customer meets them:
 *
 *  1. a shortlist to choose from — up to four, emptiest van first;
 *  2. nothing to offer, which says a driver is being assigned (and pages ops
 *     behind the scenes) rather than showing an empty list;
 *  3. a chosen driver, their distance, their ETA and where the bags are.
 *
 * WHY THERE IS NO MAP. A map is a library, tiles from a third-party host, and
 * a coordinate for a person's live position rendered at street resolution. A
 * distance and an updating ETA answer the actual question — "how long until
 * somebody knocks" — with none of that. This is a deliberate scope decision
 * for the slice, not an oversight; see RUN-REPORT-7.
 */

export interface DriverCandidateView {
  shiftId: string;
  givenName: string | null;
  avatarUrl: string | null;
  truckName: string;
  /** Room left on that van after this booking's bags. */
  availableCapacity: number;
  outOfZone: boolean;
  /** Preformatted by `formatEtaRange` — "20–30 min" or "ETA on the way". */
  etaLabel: string;
  /** True when the ETA is a real estimate rather than the fallback phrase. */
  hasEta: boolean;
}

export interface SelectedDriverView {
  givenName: string | null;
  avatarUrl: string | null;
  truckName: string;
  etaLabel: string;
  /** Rounded, e.g. "3.2 km away". Null when the driver has not pinged. */
  distanceLabel: string | null;
  /** Airport-local, preformatted. Null when there is no position yet. */
  lastSeenLabel: string | null;
  /** Where the bags are, as a milestone index into `PICKUP_STEPS`. */
  stepIndex: number;
}

/* ------------------------------------------------------------------ */
/* 1. Choosing                                                          */
/* ------------------------------------------------------------------ */

export function DriverChoice({
  bookingId,
  candidates,
}: {
  bookingId: string;
  candidates: DriverCandidateView[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SelectDriverState, FormData>(
    selectDriverAction,
    {},
  );

  // A lost race is not a dead end. `revalidatePath` already ran server-side;
  // this pulls the refreshed shortlist so the customer's next click is a
  // different driver rather than a retry of the one who just filled up.
  useEffect(() => {
    if (state.stale) router.refresh();
  }, [state.stale, router]);

  if (candidates.length === 0) return <NoDriverYet />;

  const allOutOfZone = candidates.every((c) => c.outOfZone);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">Choose your driver</CardTitle>
        <CardDescription>
          {allOutOfZone
            ? "Everyone close by is full right now, so these drivers are coming from a little further out — they will take a bit longer to reach you."
            : "Your bags are sealed and ready. Pick whoever suits you; they will collect your bags and deliver them to your airline's bag drop."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}

        <ul className="grid gap-3 sm:grid-cols-2">
          {candidates.map((candidate) => (
            <li key={candidate.shiftId}>
              <form action={formAction}>
                <input type="hidden" name="bookingId" value={bookingId} />
                <input type="hidden" name="shiftId" value={candidate.shiftId} />
                <div className="flex h-full flex-col gap-3 rounded-lg border border-border p-4">
                  <div className="flex items-center gap-3">
                    <Avatar
                      size="md"
                      name={candidate.givenName}
                      src={candidate.avatarUrl}
                      alt=""
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {candidate.givenName ?? "Koolee driver"}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {candidate.truckName}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant={candidate.hasEta ? "default" : "secondary"}>
                      {candidate.etaLabel}
                    </Badge>
                    {candidate.outOfZone ? (
                      <Badge variant="secondary">Coming from further out</Badge>
                    ) : null}
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Room for {candidate.availableCapacity} more{" "}
                    {candidate.availableCapacity === 1 ? "bag" : "bags"} after yours.
                  </p>

                  <Button type="submit" className="mt-auto w-full" loading={pending}>
                    Choose {candidate.givenName ?? "this driver"}
                  </Button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Nothing to offer.
 *
 * It does NOT say "no drivers available" — that is a Koolee staffing problem
 * described to the customer as their problem, and there is nothing they can do
 * with it. The page tells them what will happen; the ops alert (raised
 * server-side, once an hour at most) is what makes that sentence true.
 */
function NoDriverYet() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">
          We&rsquo;re assigning your driver
        </CardTitle>
        <CardDescription>
          Your bags are sealed and ready to go. We&rsquo;re matching you with a driver
          now — you&rsquo;ll get a confirmation as soon as they&rsquo;re on it.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Watching                                                          */
/* ------------------------------------------------------------------ */

/**
 * REFRESH IS NOT THIS COMPONENT'S JOB ANY MORE.
 *
 * This used to own a 30-second `setInterval(router.refresh)`, which made the
 * page live only once a driver had been chosen — an agent sealing bags on the
 * doorstep changed nothing on the screen the customer was watching. `TripLive`
 * now sits at page level and refreshes on a `booking_signals` change (with the
 * same interval as its fallback), so everything on the page updates, not one
 * card. Do not re-add a timer here.
 */
export function DriverTracking({
  driver,
  /** False once the bags are delivered — nothing left to track. */
  live,
}: {
  driver: SelectedDriverView;
  live: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">Your driver</CardTitle>
        <CardDescription>
          {live
            ? "Updating as your driver moves."
            : "Your bags are with your airline now."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar size="lg" name={driver.givenName} src={driver.avatarUrl} alt="" />
          <div className="min-w-0">
            <p className="font-medium">{driver.givenName ?? "Your Koolee driver"}</p>
            <p className="text-sm text-muted-foreground">{driver.truckName}</p>
          </div>
          {live ? (
            <div className="ml-auto text-right">
              <p className="font-display text-lg">{driver.etaLabel}</p>
              <p className="text-sm text-muted-foreground">
                {driver.distanceLabel ?? "Position updating"}
              </p>
            </div>
          ) : null}
        </div>

        <PickupProgress stepIndex={driver.stepIndex} />

        {live && driver.lastSeenLabel ? (
          <p className="text-xs text-muted-foreground">
            Location last updated {driver.lastSeenLabel}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Where the bags are, as a track with a current position.
 *
 * `MilestoneTrack` in @koolee/ui renders a progression but has no notion of
 * "you are here", which is the only thing this needs to say. Kept local to the
 * web app until a second app needs it — at which point it is lifted, per the
 * shared-component rule.
 */
export function PickupProgress({ stepIndex }: { stepIndex: number }) {
  return (
    <ol className="flex flex-col gap-0 sm:flex-row sm:items-start sm:gap-0">
      {PICKUP_STEPS.map((step, i) => {
        const done = i < stepIndex;
        const current = i === stepIndex;
        return (
          <li
            key={step}
            className="flex flex-1 items-center gap-3 sm:flex-col sm:items-start sm:gap-2"
            aria-current={current ? "step" : undefined}
          >
            <div className="flex items-center gap-0 sm:w-full">
              <span
                className={
                  done || current
                    ? "size-2.5 shrink-0 rounded-full bg-sky-500"
                    : "size-2.5 shrink-0 rounded-full bg-navy-200"
                }
                aria-hidden="true"
              />
              {i < PICKUP_STEPS.length - 1 ? (
                <span
                  className={
                    done
                      ? "hidden h-px flex-1 bg-sky-500 sm:block"
                      : "hidden h-px flex-1 bg-navy-200 sm:block"
                  }
                  aria-hidden="true"
                />
              ) : null}
            </div>
            <span
              className={
                current
                  ? "text-sm font-medium"
                  : done
                    ? "text-sm text-muted-foreground"
                    : "text-sm text-navy-300"
              }
            >
              {step}
              {current ? <span className="sr-only"> — current step</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

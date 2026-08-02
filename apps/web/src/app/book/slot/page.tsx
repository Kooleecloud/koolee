import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@koolee/ui";
import { formatWindowInAirportTz, listSellableSlots, type Slot } from "@koolee/core";

import { submitSlot } from "@/app/book/actions";
import { StepForm } from "@/components/step-form";
import { readDraft } from "@/lib/booking-draft";
import { tryGetCore } from "@/lib/core";

export const metadata = { title: "Pickup window" };
export const dynamic = "force-dynamic";

const TIER_LABEL: Record<string, string> = {
  standard_4h: "Standard · 4-hour window",
  express_2h: "Express · 2-hour window",
  priority_1h: "Priority · 1-hour window",
};

export default async function SlotStepPage() {
  const draft = await readDraft();

  if (!draft.departureAirport || !draft.departureAt || !draft.airlineIata) {
    return <Incomplete />;
  }

  const core = tryGetCore();
  if (!core) return <NoDatabase />;

  let slots: Slot[] = [];
  let tz = "America/New_York";
  let cutoffMinutes: number | null = null;
  let loadError: string | null = null;

  try {
    const result = await listSellableSlots(core, {
      airportCode: draft.departureAirport,
      airlineIata: draft.airlineIata,
      scope: draft.scope ?? "domestic",
      departureAt: new Date(draft.departureAt),
    });
    slots = result.slots;
    tz = result.tz;
    cutoffMinutes = result.cutoffMinutes;
  } catch (error: unknown) {
    loadError = error instanceof Error ? error.message : "Could not load pickup windows.";
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Pickup window</h1>
        <p className="text-sm text-muted-foreground">
          Only windows that can still get your bags to {draft.airlineIata}&apos;s bag drop
          at {draft.departureAirport} before the cutoff are shown.
          {cutoffMinutes !== null && (
            <> That cutoff is {cutoffMinutes} minutes before departure.</>
          )}
        </p>
      </header>

      {loadError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {loadError}
        </p>
      )}

      {!loadError && slots.length === 0 ? (
        <NoSlots />
      ) : (
        <StepForm action={submitSlot} submitLabel="Continue">
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">Available pickup windows</legend>
            {slots.map((slot) => (
              <label
                key={slot.id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-accent/10 has-checked:border-primary has-checked:bg-primary/5"
              >
                <input
                  type="radio"
                  name="slotId"
                  value={slot.id}
                  defaultChecked={draft.slotId === slot.id}
                  className="mt-1"
                  required
                />
                <span className="flex flex-1 flex-col gap-1">
                  <span className="font-medium">
                    {formatWindowInAirportTz(slot.windowStart, slot.windowEnd, tz)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {TIER_LABEL[slot.tier] ?? slot.tier}
                  </span>
                </span>
                <Badge variant="secondary">{slot.capacity - slot.bookedCount} left</Badge>
              </label>
            ))}
          </fieldset>
        </StepForm>
      )}
    </div>
  );
}

function NoSlots() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">No windows can make that flight</CardTitle>
        <CardDescription>
          Every remaining pickup window would finish after your airline stops accepting
          checked bags. We will not sell one that cannot make it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Button asChild variant="outline">
          <Link href="/book/flight">Change flight</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function Incomplete() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tell us about your flight first</CardTitle>
        <CardDescription>
          We need the flight and airport before we can show pickup windows.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href="/book/flight">Back to flight details</Link>
        </Button>
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

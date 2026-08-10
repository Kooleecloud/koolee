"use client";

import * as React from "react";
import { useActionState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormMessage,
  Input,
  Label,
  Select,
  usePreservedFormValues,
} from "@koolee/ui";

import {
  arriveAction,
  completeVisitAction,
  reportExceptionAction,
  sealBagAction,
  verifyIdentityAction,
  type VisitActionState,
} from "./actions";

/**
 * The guided verification visit. Screen order (a deliberate design call —
 * logged in RUN-REPORT.md): arrive → ID check → per-bag seal loop →
 * completion. Every submit hits a server action that appends the custody
 * event; this component only renders progress derived from the timeline.
 *
 * GPS: captured best-effort from the browser at mount and attached to every
 * step as hidden fields. Denied/unavailable geolocation degrades to null —
 * never blocks the visit.
 */

export interface VisitBagView {
  id: string;
  sealId: string | null;
  weightKg: string | null;
  photoCount: number;
}

export interface VisitView {
  taskId: string;
  paxName: string;
  bookingStatus: string;
  arrived: boolean;
  identityVerified: boolean;
  bags: VisitBagView[];
  done: boolean;
  exception: boolean;
}

function useGps() {
  const [coords, setCoords] = React.useState<{ lat: number; lng: number } | null>(null);
  React.useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => setCoords(null),
      { enableHighAccuracy: false, timeout: 5_000 },
    );
  }, []);
  return coords;
}

function GpsFields({ coords }: { coords: { lat: number; lng: number } | null }) {
  if (!coords) return null;
  return (
    <>
      <input type="hidden" name="lat" value={coords.lat} />
      <input type="hidden" name="lng" value={coords.lng} />
    </>
  );
}

function StepBadge({ done, label }: { done: boolean; label: string }) {
  return <Badge variant={done ? "success" : "secondary"}>{done ? "done" : label}</Badge>;
}

export function VisitFlow({ view }: { view: VisitView }) {
  const coords = useGps();

  if (view.exception) {
    return (
      <FormMessage variant="info">
        This visit was flagged as a problem — ops is on it. Nothing more to do here.
      </FormMessage>
    );
  }
  if (view.done) {
    return (
      <FormMessage variant="success">
        Visit complete. Bags are sealed, recorded, and ready for pickup.
      </FormMessage>
    );
  }

  const allSealed = view.bags.every((bag) => bag.sealId);

  return (
    <div className="flex flex-col gap-4">
      <ArriveStep view={view} coords={coords} />
      {view.arrived && <IdentityStep view={view} coords={coords} />}
      {view.arrived && view.identityVerified && (
        <>
          {view.bags.map((bag, index) => (
            <BagStep key={bag.id} view={view} bag={bag} index={index} coords={coords} />
          ))}
          <CompleteStep view={view} allSealed={allSealed} coords={coords} />
        </>
      )}
      <ExceptionStep view={view} coords={coords} />
    </div>
  );
}

function ArriveStep({
  view,
  coords,
}: {
  view: VisitView;
  coords: { lat: number; lng: number } | null;
}) {
  const [state, formAction, pending] = useActionState<VisitActionState, FormData>(
    arriveAction,
    {},
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span>1 · At the door</span>
          <StepBadge done={view.arrived} label="first" />
        </CardTitle>
        <CardDescription>
          Confirm you&apos;ve arrived — this timestamps the start of the visit in the
          custody record.
        </CardDescription>
      </CardHeader>
      {!view.arrived && (
        <CardContent>
          <form action={formAction} className="flex flex-col gap-3">
            <input type="hidden" name="taskId" value={view.taskId} />
            <GpsFields coords={coords} />
            {state.error && <FormMessage>{state.error}</FormMessage>}
            <Button type="submit" loading={pending}>
              I&apos;ve arrived
            </Button>
          </form>
        </CardContent>
      )}
    </Card>
  );
}

function IdentityStep({
  view,
  coords,
}: {
  view: VisitView;
  coords: { lat: number; lng: number } | null;
}) {
  const [state, formAction, pending] = useActionState<VisitActionState, FormData>(
    verifyIdentityAction,
    {},
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span>2 · Photo-ID check</span>
          <StepBadge done={view.identityVerified} label="next" />
        </CardTitle>
        <CardDescription>
          The name on the ID must match the ticket: <strong>{view.paxName}</strong>. If
          it doesn&apos;t, don&apos;t continue — flag a problem below.
        </CardDescription>
      </CardHeader>
      {!view.identityVerified && (
        <CardContent>
          <form action={formAction} className="flex flex-col gap-3">
            <input type="hidden" name="taskId" value={view.taskId} />
            <GpsFields coords={coords} />
            {state.error && <FormMessage>{state.error}</FormMessage>}
            <Button type="submit" loading={pending}>
              ID matches the ticket
            </Button>
          </form>
        </CardContent>
      )}
    </Card>
  );
}

function BagStep({
  view,
  bag,
  index,
  coords,
}: {
  view: VisitView;
  bag: VisitBagView;
  index: number;
  coords: { lat: number; lng: number } | null;
}) {
  const [state, formAction, pending] = useActionState<VisitActionState, FormData>(
    sealBagAction,
    {},
  );
  const { formRef, captureValues } = usePreservedFormValues(state);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span>
            3.{index + 1} · Bag {index + 1}
          </span>
          <StepBadge done={Boolean(bag.sealId)} label="to seal" />
        </CardTitle>
        {bag.sealId ? (
          <CardDescription>
            Sealed with <span className="font-mono">{bag.sealId}</span>
            {bag.weightKg ? ` · ${bag.weightKg} kg` : ""}
            {bag.photoCount > 0 ? ` · ${bag.photoCount} photo(s)` : ""}
          </CardDescription>
        ) : (
          <CardDescription>Photograph, weigh, and seal this bag.</CardDescription>
        )}
      </CardHeader>
      {!bag.sealId && (
        <CardContent>
          <form
            ref={formRef}
            action={formAction}
            onSubmit={captureValues}
            className="flex flex-col gap-3"
          >
            <input type="hidden" name="taskId" value={view.taskId} />
            <input type="hidden" name="bagId" value={bag.id} />
            <GpsFields coords={coords} />

            <div className="grid gap-2">
              <Label htmlFor={`photo-${bag.id}`}>Bag photo</Label>
              <Input
                id={`photo-${bag.id}`}
                name="photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor={`seal-${bag.id}`}>Seal id</Label>
                <Input
                  id={`seal-${bag.id}`}
                  name="sealId"
                  placeholder="type the printed id"
                  autoComplete="off"
                  required
                />
                {/* TODO(agent-flow): QR/RFID scan via the camera — manual
                    entry ships first; the seal id stays an opaque string. */}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`weight-${bag.id}`}>Weight (kg)</Label>
                <Input
                  id={`weight-${bag.id}`}
                  name="weightKg"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  max="99"
                />
              </div>
            </div>
            {state.error && <FormMessage>{state.error}</FormMessage>}
            <Button type="submit" loading={pending}>
              Record seal
            </Button>
          </form>
        </CardContent>
      )}
    </Card>
  );
}

function CompleteStep({
  view,
  allSealed,
  coords,
}: {
  view: VisitView;
  allSealed: boolean;
  coords: { lat: number; lng: number } | null;
}) {
  const [state, formAction, pending] = useActionState<VisitActionState, FormData>(
    completeVisitAction,
    {},
  );
  const sealedCount = view.bags.filter((b) => b.sealId).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">4 · Complete the visit</CardTitle>
        <CardDescription>
          {sealedCount}/{view.bags.length} bags sealed. Completing records the
          hand-off and charges the customer&apos;s card — from here the bags are in
          Koolee&apos;s custody until the airline&apos;s bag drop.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="taskId" value={view.taskId} />
          <GpsFields coords={coords} />
          {state.error && <FormMessage>{state.error}</FormMessage>}
          <Button type="submit" loading={pending} disabled={!allSealed}>
            {allSealed ? "Complete visit and charge card" : "Seal every bag first"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ExceptionStep({
  view,
  coords,
}: {
  view: VisitView;
  coords: { lat: number; lng: number } | null;
}) {
  const [state, formAction, pending] = useActionState<VisitActionState, FormData>(
    reportExceptionAction,
    {},
  );
  const { formRef, captureValues } = usePreservedFormValues(state);
  const [open, setOpen] = React.useState(false);

  if (!open) {
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
        Something&apos;s wrong — flag a problem
      </Button>
    );
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base">Flag a problem</CardTitle>
        <CardDescription>
          This stops the visit and hands the booking to ops. It can&apos;t be undone
          from here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          action={formAction}
          onSubmit={captureValues}
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="taskId" value={view.taskId} />
          <GpsFields coords={coords} />
          <div className="grid gap-2">
            <Label htmlFor="reason">What happened?</Label>
            <Select id="reason" name="reason" required defaultValue="customer_not_home">
              <option value="customer_not_home">Customer not home</option>
              <option value="customer_id_mismatch">ID doesn&apos;t match the ticket</option>
              <option value="bags_refused">Bags can&apos;t be accepted</option>
              <option value="unsafe_conditions">Unsafe conditions</option>
              <option value="other">Something else</option>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="note">Details</Label>
            <Input id="note" name="note" maxLength={500} placeholder="what ops should know" />
          </div>
          {state.error && <FormMessage>{state.error}</FormMessage>}
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" loading={pending}>
              Flag problem
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Back to the visit
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

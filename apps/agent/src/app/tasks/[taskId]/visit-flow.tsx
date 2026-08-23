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
  ImageLightbox,
  Input,
  Label,
  Select,
  usePreservedFormValues,
} from "@koolee/ui";

import { downscalePhoto } from "@/lib/photo";

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
  /** The bag's number within the booking — matches the physical tag. */
  ordinal: number;
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

/**
 * The bag photo field: capture, then SEE what was captured.
 *
 * The preview is not decoration. The agent is holding a phone at a doorway and
 * the camera returns to a form that previously showed only "1 file selected" —
 * there was no way to notice a black frame, a thumb over the lens, or a shot of
 * the wrong bag until ops opened it days later. The photo is required, so it
 * has to be checkable at the moment it is taken.
 */
function BagPhotoField({ bagId }: { bagId: string }) {
  const [preview, setPreview] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Object URLs are leaked memory until revoked — one per retake.
  React.useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  // React 19 resets the form after every action, and a file input is the one
  // field `usePreservedFormValues` cannot restore. Without this, a failed seal
  // (duplicate id, upload error) would leave a thumbnail on screen with no file
  // actually attached — the agent would resubmit believing they had a photo.
  React.useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const clear = () => setPreview(null);
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, []);

  return (
    <div className="grid gap-2">
      <Label htmlFor={`photo-${bagId}`}>Bag photo</Label>
      <Input
        ref={inputRef}
        id={`photo-${bagId}`}
        name="photo"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        required
        className={preview ? "sr-only" : undefined}
        onChange={(event) => {
          const file = event.target.files?.[0];
          setPreview(file ? URL.createObjectURL(file) : null);
        }}
      />
      {preview && (
        <div className="flex items-center gap-3">
          {/* Tap to enlarge before committing the seal. A 96px square is
              enough to see that *a* photo was taken and not enough to see
              that it is out of focus, framed on the floor, or of the wrong
              bag — which is exactly what the agent is checking for. */}
          <ImageLightbox
            src={preview}
            alt="The bag you just photographed"
            title="Bag photo"
            description="Check the bag and its seal are both readable before recording."
            className="h-24 w-24"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            Retake
          </Button>
        </div>
      )}
    </div>
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
          {view.bags.map((bag) => (
            <BagStep key={bag.id} view={view} bag={bag} coords={coords} />
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
  coords,
}: {
  view: VisitView;
  bag: VisitBagView;
  coords: { lat: number; lng: number } | null;
}) {
  const [state, formAction, pending] = useActionState<VisitActionState, FormData>(
    sealBagAction,
    {},
  );
  const { formRef, captureValues } = usePreservedFormValues(state);
  // Shrink the camera capture before it becomes a Server Action body — an
  // untouched phone photo blows the 1 MB limit and 413s before the action runs.
  const [shrinking, setShrinking] = React.useState(false);
  const submit = React.useCallback(
    async (form: FormData) => {
      const photo = form.get("photo");
      if (photo instanceof File && photo.size > 0) {
        setShrinking(true);
        try {
          form.set("photo", await downscalePhoto(photo));
        } finally {
          setShrinking(false);
        }
      }
      formAction(form);
    },
    [formAction],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          {/* Bag number comes from the row, not the array position — the
              agent has to be able to match this to the physical tag. */}
          <span>
            3.{bag.ordinal} · Bag {bag.ordinal}
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
            action={submit}
            onSubmit={captureValues}
            className="flex flex-col gap-3"
          >
            <input type="hidden" name="taskId" value={view.taskId} />
            <input type="hidden" name="bagId" value={bag.id} />
            <GpsFields coords={coords} />

            <BagPhotoField bagId={bag.id} />
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
                <p className="text-muted-foreground text-xs">
                  Unique to this bag — never reuse a number.
                </p>
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
                  min="0.1"
                  max="99"
                  required
                />
              </div>
            </div>
            {state.error && <FormMessage>{state.error}</FormMessage>}
            <Button type="submit" loading={pending || shrinking}>
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
          {/* Braces around the space: JSX drops whitespace at a line break,
              which rendered this as "0/2bags sealed". */}
          {sealedCount}/{view.bags.length}{" "}
          bags sealed. Completing records the
          hand-off — from here the bags are in Koolee&apos;s custody until the
          airline&apos;s bag drop. Billing is handled by ops; nothing about the
          customer&apos;s card happens on this device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="taskId" value={view.taskId} />
          <GpsFields coords={coords} />
          {state.error && <FormMessage>{state.error}</FormMessage>}
          <Button type="submit" loading={pending} disabled={!allSealed}>
            {allSealed ? "Complete visit" : "Seal every bag first"}
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

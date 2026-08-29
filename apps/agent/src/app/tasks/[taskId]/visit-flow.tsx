"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
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

import { downscalePhoto } from "@koolee/ui/lib/photo";

import {
  arriveAction,
  capturePassportAction,
  completeVisitAction,
  confirmPassportAction,
  reportExceptionAction,
  sealBagAction,
  type VisitActionState,
} from "./actions";

/**
 * The guided verification visit. Screen order (a deliberate design call —
 * logged in docs/run-reports/RUN-REPORT.md): arrive → identity gate → per-bag seal loop →
 * completion. Every submit hits a server action that appends the custody
 * event; this component only renders progress derived from server state.
 *
 * The seal steps render only once `identityPassed` is true, but that is
 * CONVENIENCE, not enforcement: core refuses `recordBagSealed` and
 * `completeVerificationVisit` while the gate is shut, because a server action
 * stays reachable as a POST whatever this file chooses to render.
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

export interface VisitAgreementView {
  accepted: boolean;
  /** Null only when no agreement has ever been published. */
  version: number | null;
  /** Preformatted in the BOOKING's zone, never the device's. */
  acceptedAtLabel: string | null;
}

export interface VisitPassportView {
  status: "pending" | "customer_uploaded" | "agent_confirmed" | "failed";
  /** Short-TTL signed URL, minted server-side. Null when there is no photo. */
  photoUrl: string | null;
}

export interface VisitView {
  taskId: string;
  paxName: string;
  bookingStatus: string;
  arrived: boolean;
  /** Both halves of the identity gate hold. Sealing is locked until they do. */
  identityPassed: boolean;
  agreement: VisitAgreementView;
  passport: VisitPassportView;
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

/**
 * A finished step, folded to one line.
 *
 * Every step used to keep its full card after completion, so by the time an
 * agent reached the bags they were scrolling past two panels of instructions
 * they had already followed. On a phone that is the difference between the
 * next action being on screen and being two thumb-flicks away. What is done
 * stays visible — a driver needs to see they did it — but it stops competing.
 */
function StepDone({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3">
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground"
      >
        <Check className="size-3" />
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
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
      {view.arrived && view.identityPassed && (
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

  if (view.arrived) return <StepDone label="Arrived — visit started" />;

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
            <Button type="submit" size="lg" loading={pending} className="w-full">
              I&apos;ve arrived
            </Button>
          </form>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Step 2 — the identity gate.
 *
 * Two halves, and the agent can only act on one of them. The customer's
 * agreement acceptance happens on the customer's own trip page (that is what
 * makes it an acceptance), so this panel can only report it and offer a
 * refresh. There is NO agent-side override: an override button's only use is
 * to bypass the control this step exists to be, and it would be pressed at 6am
 * by someone who just wants to finish the job. The way past a stuck gate is to
 * flag a problem, which raises the booking and reaches ops by email.
 */
function IdentityStep({
  view,
  coords,
}: {
  view: VisitView;
  coords: { lat: number; lng: number } | null;
}) {
  const router = useRouter();
  const [confirmState, confirmAction, confirming] = useActionState<
    VisitActionState,
    FormData
  >(confirmPassportAction, {});
  const [captureState, captureFormAction, capturing] = useActionState<
    VisitActionState,
    FormData
  >(capturePassportAction, {});

  // Shrink before the capture becomes a Server Action body — an untouched
  // phone photo blows the 1 MB limit and 413s before the action runs.
  const [shrinking, setShrinking] = React.useState(false);
  const submitCapture = React.useCallback(
    async (form: FormData) => {
      const photo = form.get("passport");
      if (photo instanceof File && photo.size > 0) {
        setShrinking(true);
        try {
          form.set("passport", await downscalePhoto(photo));
        } finally {
          setShrinking(false);
        }
      }
      // `<form action={asyncFn}>` opens a transition, but awaiting the
      // downscale leaves it — dispatching a `useActionState` action from
      // outside one is a React error and leaves `pending` stuck false. Re-open
      // it explicitly around the dispatch.
      React.startTransition(() => captureFormAction(form));
    },
    [captureFormAction],
  );

  const confirmed = view.passport.status === "agent_confirmed";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span>2 · Identity</span>
          <StepBadge done={view.identityPassed} label="next" />
        </CardTitle>
        <CardDescription>
          The passport must belong to the traveler on the ticket:{" "}
          <strong>{view.paxName}</strong>. If it doesn&apos;t, don&apos;t continue — flag
          a problem below.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* --- half 1: the customer's agreement ------------------------- */}
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Booking agreement</span>
            {view.agreement.accepted ? (
              <Badge variant="success">accepted</Badge>
            ) : (
              <Badge variant="warning">not accepted</Badge>
            )}
          </div>
          {view.agreement.accepted ? (
            <p className="text-xs text-muted-foreground">
              Version {view.agreement.version}
              {view.agreement.acceptedAtLabel
                ? ` · accepted ${view.agreement.acceptedAtLabel}`
                : ""}
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {view.agreement.version === null
                  ? "No agreement is published — call ops, this booking can't proceed."
                  : "Ask the customer to open their trip page and accept the agreement. You can't do this for them."}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => router.refresh()}
              >
                Check again
              </Button>
            </>
          )}
        </div>

        {/* --- half 2: the passport ------------------------------------- */}
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Passport</span>
            {confirmed ? (
              <Badge variant="success">confirmed</Badge>
            ) : view.passport.photoUrl ? (
              <Badge variant="secondary">photo on file</Badge>
            ) : (
              <Badge variant="warning">not checked</Badge>
            )}
          </div>

          {view.passport.photoUrl && (
            <div className="flex items-center gap-3">
              <ImageLightbox
                src={view.passport.photoUrl}
                alt="The traveler's passport page"
                title="Passport"
                description="Check this against the document and the person in front of you."
                className="h-24 w-24"
              />
              <p className="text-xs text-muted-foreground">
                Tap to enlarge. Compare it to the document in the traveler&apos;s hand — a
                photo on file is not a check.
              </p>
            </div>
          )}

          {!confirmed && (
            <>
              {/* Capture is optional even here: the agent may simply look at
                  the document. What is not optional is pressing confirm. */}
              <form
                action={submitCapture}
                className="flex flex-col gap-2 border-t border-border pt-3"
              >
                <input type="hidden" name="taskId" value={view.taskId} />
                <Label htmlFor="passport-photo">
                  {view.passport.photoUrl
                    ? "Replace the photo (optional)"
                    : "Photograph the passport page (optional)"}
                </Label>
                <Input
                  id="passport-photo"
                  name="passport"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                />
                {captureState.error && <FormMessage>{captureState.error}</FormMessage>}
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  loading={capturing || shrinking}
                >
                  Save photo
                </Button>
              </form>

              <form
                action={confirmAction}
                className="flex flex-col gap-2 border-t border-border pt-3"
              >
                <input type="hidden" name="taskId" value={view.taskId} />
                <GpsFields coords={coords} />
                {confirmState.error && <FormMessage>{confirmState.error}</FormMessage>}
                <Button type="submit" size="lg" loading={confirming} className="w-full">
                  Confirm passport matches the traveler
                </Button>
              </form>
            </>
          )}
        </div>

        {!view.identityPassed && view.agreement.accepted && confirmed && (
          // Defensive: the two halves say yes but the server-computed gate
          // says no. Never silently show the seal steps in that case.
          <FormMessage variant="info">
            Refresh — something changed while you were on this screen.
          </FormMessage>
        )}
      </CardContent>
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
      // Same transition re-entry as the passport capture above — see the note
      // there. Without it React errors and `pending` never flips.
      React.startTransition(() => formAction(form));
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
                  // Real scales read to 10 g — step 0.1 rejected e.g. 23.45.
                  step="0.01"
                  min="0.1"
                  max="99"
                  required
                />
              </div>
            </div>
            {state.error && <FormMessage>{state.error}</FormMessage>}
            <Button
              type="submit"
              size="lg"
              loading={pending || shrinking}
              className="w-full"
            >
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
          {sealedCount}/{view.bags.length} bags sealed. Completing records the hand-off —
          from here the bags are in Koolee&apos;s custody until the airline&apos;s bag
          drop. Billing is handled by ops; nothing about the customer&apos;s card happens
          on this device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="taskId" value={view.taskId} />
          <GpsFields coords={coords} />
          {state.error && <FormMessage>{state.error}</FormMessage>}
          <Button
            type="submit"
            size="lg"
            loading={pending}
            disabled={!allSealed}
            className="w-full"
          >
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
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full border-destructive/40 text-destructive"
        onClick={() => setOpen(true)}
      >
        Something&apos;s wrong — flag a problem
      </Button>
    );
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base">Flag a problem</CardTitle>
        <CardDescription>
          This stops the visit and hands the booking to ops. It can&apos;t be undone from
          here.
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
              <option value="customer_id_mismatch">
                ID doesn&apos;t match the ticket
              </option>
              <option value="bags_refused">Bags can&apos;t be accepted</option>
              <option value="unsafe_conditions">Unsafe conditions</option>
              <option value="other">Something else</option>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="note">Details</Label>
            <Input
              id="note"
              name="note"
              maxLength={500}
              placeholder="what ops should know"
            />
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

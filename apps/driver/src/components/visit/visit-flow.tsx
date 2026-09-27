import * as React from "react";
import { View } from "react-native";
import { Camera, Check } from "lucide-react-native";
import {
  apiRoutes,
  SEAL_ID_MAX_LENGTH,
  sealBagRequestSchema,
  VISIT_EXCEPTION_NOTE_MAX_LENGTH,
  type VisitDetail,
  type VisitExceptionReason,
} from "@koolee/api-contract";

import { gpsBody, useGps, type Gps } from "@/components/task/use-gps";
import { QUEUED_COPY, stepErrorMessage, useStep } from "@/components/task/use-step";
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
  Text,
} from "@/components/ui";
import {
  bagPhotoKey,
  passportPhotoKey,
  takePhoto,
  type PreparedPhoto,
} from "@/lib/photos";

import {
  allSealed,
  DEFAULT_VISIT_EXCEPTION_REASON,
  sealedCount,
  VISIT_EXCEPTION_OPTIONS,
  visitViewFrom,
  type VisitBagView,
  type VisitView,
} from "./visit-view";

/**
 * The guided verification visit — the web's `visit-flow.tsx`, step for step.
 * Screen order: arrive → identity gate → per-bag seal loop → completion.
 * Every submit POSTs the step through `runStep`, which appends the custody
 * event server-side; this component only renders progress derived from
 * server state, refetched after each one.
 *
 * The seal steps render only once `identityPassed` is true, but that is
 * CONVENIENCE, not enforcement: core refuses the seal and complete routes
 * while the gate is shut, whatever this file chooses to render.
 *
 * WHAT DIFFERS FROM THE WEB. A `<form>` posting a `File` became the camera
 * (`takePhoto`), an upload straight to Storage, and a POST naming the object
 * path — and a tap without signal is queued rather than failed. A queued
 * step disables its button and says so, because the refetch that would have
 * folded it away cannot happen until the signal is back.
 */

const KIND = "verification" as const;

export function VisitFlow({
  detail,
  onRefresh,
  refreshing = false,
}: {
  detail: VisitDetail;
  /** The identity step's "Check again": refetch the detail. */
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const view = React.useMemo(() => visitViewFrom(detail), [detail]);
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

  return (
    <View className="gap-4" testID="visit-flow">
      <ArriveStep view={view} coords={coords} />
      {view.arrived ? (
        <IdentityStep
          view={view}
          coords={coords}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
      ) : null}
      {view.arrived && view.identityPassed ? (
        <>
          {view.bags.map((bag) => (
            <BagStep key={bag.id} view={view} bag={bag} coords={coords} />
          ))}
          <CompleteStep view={view} coords={coords} />
        </>
      ) : null}
      <ExceptionStep view={view} coords={coords} />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Shared step chrome                                                  */
/* ------------------------------------------------------------------ */

function StepBadge({ done, label }: { done: boolean; label: string }) {
  return <Badge variant={done ? "success" : "secondary"}>{done ? "done" : label}</Badge>;
}

/**
 * A finished step, folded to one line. What is done stays visible — a
 * driver needs to see they did it — but it stops competing with the next
 * action for the screen.
 */
function StepDone({ label, testID }: { label: string; testID?: string }) {
  return (
    <View
      testID={testID}
      className="flex-row items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3"
    >
      <View className="h-5 w-5 items-center justify-center rounded-full bg-success">
        <Check size={12} color="#f8fafc" />
      </View>
      <Text className="flex-1 text-sm text-muted-foreground">{label}</Text>
    </View>
  );
}

function StepTitle({ children, badge }: { children: string; badge?: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <CardTitle className="flex-1">{children}</CardTitle>
      {badge}
    </View>
  );
}

/** The two lines a step can end on: the server's refusal, or "it is waiting". */
function StepOutcome({ error, queued }: { error: unknown; queued: boolean }) {
  if (error) return <FormMessage>{stepErrorMessage(error)}</FormMessage>;
  if (queued) return <FormMessage variant="info">{QUEUED_COPY}</FormMessage>;
  return null;
}

/* ------------------------------------------------------------------ */
/* Step 1 · At the door                                                */
/* ------------------------------------------------------------------ */

function ArriveStep({ view, coords }: { view: VisitView; coords: Gps | null }) {
  const step = useStep(view.taskId, KIND);
  const queued = step.data?.queued === true;

  if (view.arrived)
    return <StepDone label="Arrived — visit started" testID="visit-arrived" />;

  return (
    <Card testID="visit-step-arrive">
      <CardHeader>
        <StepTitle badge={<StepBadge done={view.arrived} label="first" />}>
          1 · At the door
        </StepTitle>
        <CardDescription>
          Confirm you've arrived — this timestamps the start of the visit in the custody
          record.
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        <StepOutcome error={step.error} queued={queued} />
        <Button
          size="lg"
          className="w-full"
          testID="visit-arrive"
          loading={step.isPending}
          disabled={queued}
          onPress={() =>
            step.mutate({
              label: "Arrive at the door",
              path: apiRoutes.visit.arrive(view.taskId),
              body: gpsBody(coords),
            })
          }
        >
          I've arrived
        </Button>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 · Identity                                                   */
/* ------------------------------------------------------------------ */

/**
 * Two halves, and the driver can only act on one of them. The customer's
 * agreement acceptance happens on the customer's own trip page (that is what
 * makes it an acceptance), so this panel can only report it and offer a
 * refresh. There is NO driver-side override: the way past a stuck gate is
 * to flag a problem, which raises the booking and reaches ops.
 */
function IdentityStep({
  view,
  coords,
  onRefresh,
  refreshing,
}: {
  view: VisitView;
  coords: Gps | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const confirm = useStep(view.taskId, KIND);
  const capture = useStep(view.taskId, KIND);
  // The camera and the downscale run before the mutation exists, so their
  // refusals (permission, a photo that would not encode) land here.
  const [capturing, setCapturing] = React.useState(false);
  const [captureError, setCaptureError] = React.useState<unknown>(null);

  const confirmed = view.passport.status === "agent_confirmed";
  const captureQueued = capture.data?.queued === true;
  const confirmQueued = confirm.data?.queued === true;

  const photographPassport = async () => {
    setCaptureError(null);
    setCapturing(true);
    try {
      const photo = await takePhoto();
      if (!photo) return;
      const target = passportPhotoKey(view.bookingId, photo.mimeType);
      capture.mutate({
        label: "Save passport photo",
        path: apiRoutes.visit.capturePassport(view.taskId),
        body: { storagePath: target.path },
        photo: { ...target, uri: photo.uri, contentType: photo.mimeType },
      });
    } catch (error) {
      setCaptureError(error);
    } finally {
      setCapturing(false);
    }
  };

  return (
    <Card testID="visit-step-identity">
      <CardHeader>
        <StepTitle badge={<StepBadge done={view.identityPassed} label="next" />}>
          2 · Identity
        </StepTitle>
        <CardDescription>
          The passport must belong to the traveler on the ticket:{" "}
          <Text weight="semibold" className="text-sm text-muted-foreground">
            {view.paxName}
          </Text>
          . If it doesn't, don't continue — flag a problem below.
        </CardDescription>
      </CardHeader>

      <CardContent className="gap-4">
        {/* --- half 1: the customer's agreement ------------------------- */}
        <View
          className="gap-2 rounded-lg border border-border p-3"
          testID="identity-agreement"
        >
          <View className="flex-row items-center justify-between gap-3">
            <Text weight="medium" className="text-sm text-foreground">
              Booking agreement
            </Text>
            {view.agreement.accepted ? (
              <Badge variant="success">accepted</Badge>
            ) : (
              <Badge variant="warning">not accepted</Badge>
            )}
          </View>
          {view.agreement.accepted ? (
            <Text className="text-xs text-muted-foreground">
              Version {view.agreement.version}
              {view.agreement.acceptedAtLabel
                ? ` · accepted ${view.agreement.acceptedAtLabel}`
                : ""}
            </Text>
          ) : (
            <>
              <Text className="text-xs text-muted-foreground">
                {view.agreement.version === null
                  ? "No agreement is published — call ops, this booking can't proceed."
                  : "Ask the customer to open their trip page and accept the agreement. You can't do this for them."}
              </Text>
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                testID="identity-check-again"
                loading={refreshing}
                onPress={onRefresh}
              >
                Check again
              </Button>
            </>
          )}
        </View>

        {/* --- half 2: the passport ------------------------------------- */}
        <View
          className="gap-3 rounded-lg border border-border p-3"
          testID="identity-passport"
        >
          <View className="flex-row items-center justify-between gap-3">
            <Text weight="medium" className="text-sm text-foreground">
              Passport
            </Text>
            {confirmed ? (
              <Badge variant="success">confirmed</Badge>
            ) : view.passport.photoUrl ? (
              <Badge variant="secondary">photo on file</Badge>
            ) : (
              <Badge variant="warning">not checked</Badge>
            )}
          </View>

          {view.passport.photoUrl ? (
            <View className="flex-row items-center gap-3">
              <ImageLightbox
                src={view.passport.photoUrl}
                alt="The traveler's passport page"
                title="Passport"
                description="Check this against the document and the person in front of you."
                className="h-24 w-24"
                testID="passport-photo"
              />
              <Text className="flex-1 text-xs text-muted-foreground">
                Tap to enlarge. Compare it to the document in the traveler's hand — a
                photo on file is not a check.
              </Text>
            </View>
          ) : null}

          {!confirmed ? (
            <>
              {/* Capture is optional even here: the driver may simply look
                  at the document. What is not optional is pressing confirm.
                  The OS camera's own "Use photo / Retake" screen stands in
                  for the web's pick-then-"Save photo" pair, so one tap
                  captures, shrinks, uploads and records. */}
              <View className="gap-2 border-t border-border pt-3">
                <Label>
                  {view.passport.photoUrl
                    ? "Replace the photo (optional)"
                    : "Photograph the passport page (optional)"}
                </Label>
                <StepOutcome
                  error={captureError ?? capture.error}
                  queued={captureQueued}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  testID="passport-capture"
                  icon={<Camera size={16} color="#0b2545" />}
                  loading={capturing || capture.isPending}
                  disabled={captureQueued}
                  onPress={() => void photographPassport()}
                >
                  Save photo
                </Button>
              </View>

              <View className="gap-2 border-t border-border pt-3">
                <StepOutcome error={confirm.error} queued={confirmQueued} />
                <Button
                  size="lg"
                  className="w-full"
                  testID="passport-confirm"
                  loading={confirm.isPending}
                  disabled={confirmQueued}
                  onPress={() =>
                    confirm.mutate({
                      label: "Confirm the passport",
                      path: apiRoutes.visit.confirmPassport(view.taskId),
                      body: gpsBody(coords),
                    })
                  }
                >
                  Confirm passport matches the traveler
                </Button>
              </View>
            </>
          ) : null}
        </View>

        {!view.identityPassed && view.agreement.accepted && confirmed ? (
          // Defensive: the two halves say yes but the server-computed gate
          // says no. Never silently show the seal steps in that case.
          <FormMessage variant="info">
            Refresh — something changed while you were on this screen.
          </FormMessage>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3.n · Bag                                                      */
/* ------------------------------------------------------------------ */

/** The web action's own sentence for a seal submitted without a photo. */
const NO_BAG_PHOTO = "Take a photo of the bag before sealing it.";

function BagStep({
  view,
  bag,
  coords,
}: {
  view: VisitView;
  bag: VisitBagView;
  coords: Gps | null;
}) {
  const step = useStep(view.taskId, KIND);
  const [photo, setPhoto] = React.useState<PreparedPhoto | null>(null);
  const [capturing, setCapturing] = React.useState(false);
  const [sealId, setSealId] = React.useState("");
  const [weight, setWeight] = React.useState("");
  // A refusal from this side of the wire: the camera, the downscale, or a
  // field the contract would not take. Shown in the same place as the
  // server's, cleared on the next attempt.
  const [localError, setLocalError] = React.useState<unknown>(null);
  const queued = step.data?.queued === true;
  const n = bag.ordinal;

  const photograph = async () => {
    setLocalError(null);
    setCapturing(true);
    try {
      const next = await takePhoto();
      if (next) setPhoto(next);
    } catch (error) {
      setLocalError(error);
    } finally {
      setCapturing(false);
    }
  };

  const record = () => {
    setLocalError(null);
    if (!photo) {
      setLocalError(new Error(NO_BAG_PHOTO));
      return;
    }
    const target = bagPhotoKey(bag.id, photo.mimeType);
    // The contract's own messages ("Enter the seal id.", "Weight must be
    // under 99 kg.") rather than a second copy here. A comma decimal is
    // what some keyboards produce; the scale reads to 10 g either way.
    const parsed = sealBagRequestSchema.safeParse({
      ...gpsBody(coords),
      bagId: bag.id,
      sealId,
      weightKg: Number.parseFloat(weight.trim().replace(",", ".")),
      photoPath: target.path,
    });
    if (!parsed.success) {
      setLocalError(
        new Error(parsed.error.issues[0]?.message ?? "Check the seal details."),
      );
      return;
    }
    step.mutate({
      label: `Seal bag ${n}`,
      path: apiRoutes.visit.sealBag(view.taskId),
      body: parsed.data,
      photo: { ...target, uri: photo.uri, contentType: photo.mimeType },
    });
  };

  return (
    <Card testID={`visit-step-bag-${n}`}>
      <CardHeader>
        {/* Bag number comes from the row, not the array position — the
            driver has to be able to match this to the physical tag. */}
        <StepTitle badge={<StepBadge done={Boolean(bag.sealId)} label="to seal" />}>
          {`3.${n} · Bag ${n}`}
        </StepTitle>
        {bag.sealId ? (
          <CardDescription>
            Sealed with{" "}
            <Text face="mono" className="text-sm text-muted-foreground">
              {bag.sealId}
            </Text>
            {bag.weightKg ? ` · ${bag.weightKg} kg` : ""}
            {bag.photoCount > 0 ? ` · ${bag.photoCount} photo(s)` : ""}
          </CardDescription>
        ) : (
          <CardDescription>Photograph, weigh, and seal this bag.</CardDescription>
        )}
      </CardHeader>
      {!bag.sealId ? (
        <CardContent className="gap-3">
          {/* The bag photo: capture, then SEE what was captured. A 96px
              square is enough to see that *a* photo was taken and not enough
              to see that it is out of focus or of the wrong bag — which is
              exactly what the lightbox is for. */}
          <View className="gap-2">
            <Label>Bag photo</Label>
            {photo ? (
              <View className="flex-row items-center gap-3">
                <ImageLightbox
                  src={photo.uri}
                  alt="The bag you just photographed"
                  title="Bag photo"
                  description="Check the bag and its seal are both readable before recording."
                  className="h-24 w-24"
                  testID={`bag-photo-preview-${n}`}
                />
                <Button
                  variant="outline"
                  size="sm"
                  testID={`bag-photo-retake-${n}`}
                  loading={capturing}
                  onPress={() => void photograph()}
                >
                  Retake
                </Button>
              </View>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                testID={`bag-photo-${n}`}
                icon={<Camera size={16} color="#0b2545" />}
                loading={capturing}
                onPress={() => void photograph()}
              >
                Take photo
              </Button>
            )}
          </View>

          <View className="flex-row gap-3">
            <View className="flex-1 gap-2">
              <Label>Seal id</Label>
              <Input
                testID={`seal-input-${n}`}
                value={sealId}
                onChangeText={setSealId}
                placeholder="type the printed id"
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                maxLength={SEAL_ID_MAX_LENGTH}
              />
              <Text className="text-xs text-muted-foreground">
                Unique to this bag — never reuse a number.
              </Text>
              {/* TODO(agent-flow): QR/RFID scan via the camera — manual
                  entry ships first; the seal id stays an opaque string. */}
            </View>
            <View className="flex-1 gap-2">
              <Label>Weight (kg)</Label>
              <Input
                testID={`weight-input-${n}`}
                value={weight}
                onChangeText={setWeight}
                keyboardType="decimal-pad"
                inputMode="decimal"
              />
            </View>
          </View>
          <StepOutcome error={localError ?? step.error} queued={queued} />
          <Button
            size="lg"
            className="w-full"
            testID={`seal-record-${n}`}
            loading={step.isPending}
            disabled={queued}
            onPress={record}
          >
            Record seal
          </Button>
        </CardContent>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Step 4 · Complete                                                   */
/* ------------------------------------------------------------------ */

function CompleteStep({ view, coords }: { view: VisitView; coords: Gps | null }) {
  const step = useStep(view.taskId, KIND);
  const queued = step.data?.queued === true;
  const sealed = allSealed(view);

  return (
    <Card testID="visit-step-complete">
      <CardHeader>
        <CardTitle>4 · Complete the visit</CardTitle>
        <CardDescription>
          {sealedCount(view)}/{view.bags.length} bags sealed. Completing records the
          hand-off — from here the bags are in Koolee's custody until the airline's bag
          drop. Billing is handled by ops; nothing about the customer's card happens on
          this device.
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        <StepOutcome error={step.error} queued={queued} />
        <Button
          size="lg"
          className="w-full"
          testID="visit-complete"
          loading={step.isPending}
          disabled={!sealed || queued}
          onPress={() =>
            step.mutate({
              label: "Complete the visit",
              path: apiRoutes.visit.complete(view.taskId),
              body: gpsBody(coords),
            })
          }
        >
          {sealed ? "Complete visit" : "Seal every bag first"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Exception                                                           */
/* ------------------------------------------------------------------ */

function ExceptionStep({ view, coords }: { view: VisitView; coords: Gps | null }) {
  const step = useStep(view.taskId, KIND);
  const queued = step.data?.queued === true;
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState<VisitExceptionReason>(
    DEFAULT_VISIT_EXCEPTION_REASON,
  );
  const [note, setNote] = React.useState("");

  if (!open) {
    return (
      <Button
        variant="outline"
        size="lg"
        className="w-full border-destructive/40"
        testID="visit-flag-problem"
        onPress={() => setOpen(true)}
      >
        <Text weight="medium" className="text-base text-destructive">
          Something's wrong — flag a problem
        </Text>
      </Button>
    );
  }

  return (
    <Card className="border-destructive/40" testID="visit-step-exception">
      <CardHeader>
        <CardTitle>Flag a problem</CardTitle>
        <CardDescription>
          This stops the visit and hands the booking to ops. It can't be undone from here.
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        <View className="gap-2">
          <Label>What happened?</Label>
          <Select
            testID="exception-reason"
            label="What happened?"
            value={reason}
            onValueChange={setReason}
            items={VISIT_EXCEPTION_OPTIONS}
          />
        </View>
        <View className="gap-2">
          <Label>Details</Label>
          <Input
            testID="exception-note"
            value={note}
            onChangeText={setNote}
            maxLength={VISIT_EXCEPTION_NOTE_MAX_LENGTH}
            placeholder="what ops should know"
          />
        </View>
        <StepOutcome error={step.error} queued={queued} />
        <View className="flex-row gap-2">
          <Button
            variant="destructive"
            testID="exception-submit"
            loading={step.isPending}
            disabled={queued}
            onPress={() =>
              step.mutate({
                label: "Flag a problem",
                path: apiRoutes.visit.exception(view.taskId),
                body: {
                  ...gpsBody(coords),
                  reason,
                  ...(note.trim().length > 0 ? { note: note.trim() } : {}),
                },
              })
            }
          >
            Flag problem
          </Button>
          <Button
            variant="ghost"
            testID="exception-cancel"
            onPress={() => setOpen(false)}
          >
            Back to the visit
          </Button>
        </View>
      </CardContent>
    </Card>
  );
}

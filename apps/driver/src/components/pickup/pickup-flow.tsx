import * as React from "react";
import { View } from "react-native";
import {
  apiRoutes,
  VISIT_EXCEPTION_NOTE_MAX_LENGTH,
  type PickupDetail,
  type PickupExceptionReason,
} from "@koolee/api-contract";
import { Check, PackageCheck, ScanLine } from "lucide-react-native";

import { gpsBody, useGps, type Gps } from "@/components/task/use-gps";
import { QUEUED_COPY, useStep } from "@/components/task/use-step";
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
  Text,
} from "@/components/ui";
import { ApiRequestError, NetworkError } from "@/lib/api";

import {
  DEFAULT_PICKUP_EXCEPTION_REASON,
  isDelivered,
  PICKUP_EXCEPTION_OPTIONS,
  pickupViewFrom,
  scannedCount,
  type PickupView,
} from "./pickup-view";
import { SealScanner } from "./seal-scanner";

/**
 * The pickup run, guided — apps/agent `pickup-flow.tsx` on the phone.
 *
 * Screen order matches the physical order: set off → scan every seal at the
 * door → drive → drop at the counter → confirm the airline took them. Each
 * step is one POST through `runStep`, which either lands now or waits in the
 * on-device queue for a signal; this component renders progress derived from
 * server state and nothing else.
 *
 * The steps render in sequence, but that is CONVENIENCE, not enforcement.
 * Core refuses a scan before the run has started, and refuses a delivery with
 * a bag never scanned — because a route stays reachable as a POST whatever
 * this file chooses to draw.
 *
 * Retries are safe by construction: every underlying core function is
 * idempotent and every POST carries a device-minted key, so a driver in a
 * basement car park who taps twice gets one custody event and no error.
 */

export type { PickupBagView, PickupView } from "./pickup-view";

export function PickupFlowScreen({
  detail,
  taskId,
  refetch,
}: {
  detail: PickupDetail;
  taskId: string;
  refetch: () => Promise<unknown>;
}) {
  const coords = useGps();
  const view = React.useMemo(() => pickupViewFrom(detail), [detail]);
  // `useStep` already invalidates the list and this task's detail; the
  // refetch on top is the screen's own read, awaited so a step's spinner
  // holds until the flow is drawing what the server now believes.
  const afterStep = React.useCallback(async () => {
    await refetch();
  }, [refetch]);

  return <PickupFlow view={view} taskId={taskId} coords={coords} afterStep={afterStep} />;
}

export function PickupFlow({
  view,
  taskId,
  coords,
  afterStep,
}: {
  view: PickupView;
  taskId: string;
  coords: Gps | null;
  /** Runs after a step lands (or is queued) and the caches are invalidated. */
  afterStep: () => Promise<void>;
}) {
  if (view.exception) {
    return (
      <Card className="border-dashed" testID="pickup-handed-to-ops">
        <CardHeader>
          <CardTitle>Handed to ops</CardTitle>
          <CardDescription>
            You reported a problem on {view.bookingRef}. Ops has it — they will call you
            if they need anything else.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const scanned = scannedCount(view);
  const allScanned = view.bags.length > 0 && scanned === view.bags.length;
  const delivered = isDelivered(view);
  const step = { view, taskId, coords, afterStep };

  return (
    <View className="gap-4">
      {view.truckName ? (
        <Text className="text-sm text-muted-foreground">
          Running as{" "}
          <Text weight="medium" className="text-sm text-muted-foreground">
            {view.truckName}
          </Text>
          .
        </Text>
      ) : null}

      <StepSetOff {...step} />

      {view.travelStarted ? <StepSeals {...step} scanned={scanned} /> : null}

      {allScanned && !delivered ? <StepDeliver {...step} /> : null}

      {delivered ? <StepHandover {...step} /> : null}

      {!view.done ? <ExceptionCard {...step} /> : null}
    </View>
  );
}

/* --- the step runner ------------------------------------------------ */

interface StepProps {
  view: PickupView;
  taskId: string;
  coords: Gps | null;
  afterStep: () => Promise<void>;
}

const CHECK_CONNECTION = "Check your connection and try again.";

/**
 * The web's `actionErrorMessage` rule, which the pickup actions each pair
 * with their own fallback ("Couldn't check that seal."): a server refusal is
 * shown verbatim — that is the seal-mismatch warning, among others — and
 * anything else gets the step's fallback plus the connection line.
 */
function pickupStepMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof NetworkError) return CHECK_CONNECTION;
  return `${fallback} ${CHECK_CONNECTION}`;
}

/**
 * The shared step mutation, with what a pickup step needs on top: the
 * request's path and label fixed per step, a `queued` flag so the notice
 * stays under the button after the toast has gone (and the single-tap steps
 * disable on it, as the visit flow does — a second tap would mint a second
 * key and queue the same step twice), and `onAccepted` for the one step
 * (seals) that clears its input once the value is out of its hands: taken
 * by the server, or held by the queue. A refusal leaves it in the box.
 */
function usePickupStep({
  taskId,
  label,
  path,
  fallback,
  afterStep,
  onAccepted,
}: {
  taskId: string;
  label: string;
  path: string;
  fallback: string;
  afterStep: () => Promise<void>;
  /** The server took it, or the queue holds it — never on a refusal. */
  onAccepted?: () => void;
}) {
  const mutation = useStep(taskId, "pickup");
  const [queued, setQueued] = React.useState(false);
  return {
    run: (body: Record<string, unknown>) =>
      mutation.mutate(
        { label, path, body },
        {
          onSuccess: async (result) => {
            setQueued(result.queued);
            onAccepted?.();
            await afterStep();
          },
        },
      ),
    pending: mutation.isPending,
    error: mutation.error ? pickupStepMessage(mutation.error, fallback) : null,
    queued,
  };
}

function StepNotices({ error, queued }: { error: string | null; queued: boolean }) {
  return (
    <>
      {error ? <FormMessage variant="error">{error}</FormMessage> : null}
      {queued && !error ? (
        <View testID="step-queued">
          <FormMessage variant="info">{QUEUED_COPY}</FormMessage>
        </View>
      ) : null}
    </>
  );
}

/* --- 1. set off ----------------------------------------------------- */

function StepSetOff({ view, taskId, coords, afterStep }: StepProps) {
  const step = usePickupStep({
    taskId,
    label: "Set off",
    path: apiRoutes.pickup.start(view.taskId),
    fallback: "Couldn't start the pickup.",
    afterStep,
  });

  if (view.travelStarted) {
    return (
      <View className="flex-row items-center gap-2" testID="pickup-set-off-done">
        <Check size={16} color="#199446" />
        <Text className="text-sm text-muted-foreground">
          On the way to {view.paxName}.
        </Text>
      </View>
    );
  }

  return (
    <Card testID="pickup-set-off-card">
      <CardHeader>
        <CardTitle>Set off</CardTitle>
        <CardDescription>
          Tell {view.paxName} you’re coming. From here your customer can see where you are
          and how long you’ll be.
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        <StepNotices error={step.error} queued={step.queued} />
        <Button
          size="lg"
          loading={step.pending}
          disabled={step.queued}
          testID="pickup-set-off"
          onPress={() => step.run(gpsBody(coords))}
        >
          I’m on the way
        </Button>
      </CardContent>
    </Card>
  );
}

/* --- 2. seals at the door ------------------------------------------- */

function StepSeals({
  view,
  taskId,
  coords,
  afterStep,
  scanned,
}: StepProps & { scanned: number }) {
  const [sealValue, setSealValue] = React.useState("");
  const [emptyError, setEmptyError] = React.useState<string | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const step = usePickupStep({
    taskId,
    label: "Check a seal",
    path: apiRoutes.pickup.scanSeal(view.taskId),
    fallback: "Couldn't check that seal.",
    afterStep,
    // A checked or queued seal is done with — the next bag is next; a
    // refused one stays in the box so the driver can see what was read
    // against what the server said.
    onAccepted: () => setSealValue(""),
  });

  const remaining = view.bags.length - scanned;

  function check() {
    const value = sealValue.trim();
    if (!value) {
      setEmptyError("Scan or type the seal id.");
      return;
    }
    setEmptyError(null);
    step.run({ sealValue: value, ...gpsBody(coords) });
  }

  return (
    <Card testID="pickup-seals-card">
      <CardHeader>
        <View className="flex-row items-center gap-2">
          <CardTitle>Check the seals</CardTitle>
          <Badge variant={remaining === 0 ? "success" : "secondary"}>
            {scanned} of {view.bags.length}
          </Badge>
        </View>
        <CardDescription>
          {remaining === 0
            ? "Every bag checked. They're yours now."
            : `Scan or type the seal on each bag before you load it. ${remaining} left.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-4">
        <View className="gap-1.5">
          {view.bags.map((bag) => (
            <View
              key={bag.id}
              className="flex-row items-center gap-2"
              testID={`pickup-bag-${bag.ordinal}`}
            >
              {bag.scanned ? (
                <Check size={16} color="#199446" />
              ) : (
                <View className="h-4 w-4 rounded-full border border-navy-200" />
              )}
              <Text
                className={
                  bag.scanned
                    ? "text-sm text-muted-foreground"
                    : "text-sm text-foreground"
                }
              >
                Bag {bag.ordinal}
              </Text>
              {/* The seal id is NOT printed next to the checkbox. A driver who
                  can read the expected value off the screen is not checking
                  the bag, they are copying a number. */}
              {bag.scanned ? (
                <Text className="ml-auto text-xs text-muted-foreground">checked</Text>
              ) : null}
            </View>
          ))}
        </View>

        {remaining > 0 ? (
          <View className="gap-3">
            {emptyError ? (
              <FormMessage variant="error">{emptyError}</FormMessage>
            ) : (
              <StepNotices error={step.error} queued={step.queued} />
            )}
            <View className="gap-1.5">
              <Label>Seal id</Label>
              <Input
                value={sealValue}
                onChangeText={setSealValue}
                placeholder="scan, or type the printed id"
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                returnKeyType="done"
                onSubmitEditing={check}
                editable={!step.pending}
                testID="seal-input"
              />
            </View>
            <Button size="lg" loading={step.pending} testID="seal-check" onPress={check}>
              Check this seal
            </Button>
            <Button
              variant="outline"
              size="lg"
              disabled={step.pending}
              icon={<ScanLine size={16} color="#0b2545" />}
              testID="seal-scan"
              onPress={() => setScanning(true)}
            >
              Scan a seal
            </Button>
            <SealScanner
              visible={scanning}
              onScanned={(value) => {
                setSealValue(value);
                setEmptyError(null);
                setScanning(false);
              }}
              onClose={() => setScanning(false)}
            />
          </View>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* --- 3. the bag drop ------------------------------------------------ */

function StepDeliver({ view, taskId, coords, afterStep }: StepProps) {
  const step = usePickupStep({
    taskId,
    label: "At the bag drop",
    path: apiRoutes.pickup.deliver(view.taskId),
    fallback: "Couldn't record the drop-off.",
    afterStep,
  });

  return (
    <Card testID="pickup-deliver-card">
      <CardHeader>
        <CardTitle>At the bag drop</CardTitle>
        <CardDescription>
          Tap this when you reach the {view.departureAirport} bag drop — before the
          airline takes them.
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        <StepNotices error={step.error} queued={step.queued} />
        <Button
          size="lg"
          loading={step.pending}
          disabled={step.queued}
          testID="pickup-deliver"
          onPress={() => step.run(gpsBody(coords))}
        >
          I’m at the bag drop
        </Button>
      </CardContent>
    </Card>
  );
}

/* --- 4. the airline takes them -------------------------------------- */

function StepHandover({ view, taskId, coords, afterStep }: StepProps) {
  const step = usePickupStep({
    taskId,
    label: "Hand over",
    path: apiRoutes.pickup.handover(view.taskId),
    fallback: "Couldn't close the job out.",
    afterStep,
  });

  if (view.done) {
    return (
      <Card testID="pickup-done-card">
        <CardHeader>
          <View className="flex-row items-center gap-2">
            <PackageCheck size={20} color="#199446" />
            <CardTitle>Done</CardTitle>
          </View>
          <CardDescription>
            {view.bookingRef} is closed out. {view.paxName} has been told.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card testID="pickup-handover-card">
      <CardHeader>
        <CardTitle>Hand over</CardTitle>
        <CardDescription>
          Only once the airline has actually taken the bags. If there’s a queue or the
          counter is closed, wait — the customer can see you’re there.
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        <StepNotices error={step.error} queued={step.queued} />
        <Button
          size="lg"
          loading={step.pending}
          disabled={step.queued}
          testID="pickup-handover"
          onPress={() => step.run(gpsBody(coords))}
        >
          The airline has them
        </Button>
      </CardContent>
    </Card>
  );
}

/* --- the way out ---------------------------------------------------- */

function ExceptionCard({ view, taskId, coords, afterStep }: StepProps) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState<PickupExceptionReason>(
    DEFAULT_PICKUP_EXCEPTION_REASON,
  );
  const [note, setNote] = React.useState("");
  const step = usePickupStep({
    taskId,
    label: "Report a problem",
    path: apiRoutes.pickup.exception(view.taskId),
    fallback: "Couldn't file that.",
    afterStep,
  });

  if (!open) {
    return (
      <Button
        variant="ghost"
        className="self-start"
        testID="pickup-exception-open"
        onPress={() => setOpen(true)}
      >
        Something’s wrong
      </Button>
    );
  }

  return (
    <Card className="border-destructive/30" testID="pickup-exception-card">
      <CardHeader>
        <CardTitle>Report a problem</CardTitle>
        <CardDescription>
          This parks the booking with ops and stops the run. Use it rather than guessing —
          a wrong seal or a missing bag is never yours to sort out at a doorstep.
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        <StepNotices error={step.error} queued={step.queued} />
        <View className="gap-1.5">
          <Label>What happened</Label>
          <Select
            value={reason}
            onValueChange={setReason}
            items={PICKUP_EXCEPTION_OPTIONS}
            label="What happened"
            disabled={step.pending}
            testID="pickup-exception-reason"
          />
        </View>
        <View className="gap-1.5">
          <Label>Anything else (required for “something else”)</Label>
          <Input
            value={note}
            onChangeText={setNote}
            autoComplete="off"
            maxLength={VISIT_EXCEPTION_NOTE_MAX_LENGTH}
            editable={!step.pending}
            testID="pickup-exception-note"
          />
        </View>
        <View className="flex-row gap-2">
          <Button
            variant="destructive"
            className="flex-1"
            loading={step.pending}
            disabled={step.queued}
            testID="pickup-exception-file"
            onPress={() => {
              // The route's schema drops an empty note; core is the one that
              // insists on a note for "other", in a sentence shown verbatim.
              const trimmed = note.trim();
              step.run({
                reason,
                ...(trimmed ? { note: trimmed } : {}),
                ...gpsBody(coords),
              });
            }}
          >
            File it
          </Button>
          <Button
            variant="outline"
            disabled={step.pending}
            testID="pickup-exception-cancel"
            onPress={() => setOpen(false)}
          >
            Cancel
          </Button>
        </View>
      </CardContent>
    </Card>
  );
}

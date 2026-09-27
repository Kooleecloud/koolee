import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { TriangleAlert } from "lucide-react-native";
import type { PickupDetail, TaskKind, VisitDetail } from "@koolee/api-contract";

import { PickupFlowScreen } from "@/components/pickup/pickup-flow";
import { ActionabilityNotice } from "@/components/task/actionability-notice";
import { DoorstepCard } from "@/components/task/doorstep-card";
import { TaskRecord } from "@/components/task/task-record";
import { useTaskDetail } from "@/components/task/task-query";
import { TaskStopped } from "@/components/task/task-stopped";
import {
  BackLink,
  Badge,
  Button,
  Card,
  EmptyState,
  PageSkeleton,
  Screen,
  Text,
} from "@/components/ui";
import { VisitFlow } from "@/components/visit/visit-flow";
import { ApiRequestError, NetworkError, TRANSPORT_FALLBACK } from "@/lib/api";

/**
 * `/task/[taskId]?kind=verification|pickup` — the web's `tasks/[taskId]`
 * page. One screen, three modes: the guided flow while there is work left,
 * the record when there is not, and "stopped" on top of the record when the
 * BOOKING ended underneath the task.
 *
 * Everything the web page computed on the server — actionability, the
 * signed URLs, the travel line, the cancellation — arrives in the one
 * detail read, so this file only decides which of the three to draw.
 */
export default function TaskDetailScreen() {
  const params = useLocalSearchParams<{ taskId: string; kind?: string }>();
  const taskId = params.taskId ?? "";
  // Anything but "pickup" is a verification visit, exactly as on the web.
  const kind: TaskKind = params.kind === "pickup" ? "pickup" : "verification";
  const router = useRouter();
  const detail = useTaskDetail(taskId, kind);

  // The list is where this screen was opened from; a deep link from a push
  // has no history to go back to, so it lands on the tabs instead.
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };
  const refetch = () => detail.refetch();

  return (
    <Screen
      refreshing={detail.isRefetching}
      onRefresh={() => void detail.refetch()}
      testID="task-screen"
    >
      <BackLink onPress={back} testID="task-back">
        Today
      </BackLink>

      {detail.data ? (
        detail.data.kind === "pickup" ? (
          <PickupScreen detail={detail.data.pickup} taskId={taskId} refetch={refetch} />
        ) : (
          <VerificationScreen
            detail={detail.data.visit}
            refetch={refetch}
            refreshing={detail.isRefetching}
          />
        )
      ) : detail.isError ? (
        <LoadFailed error={detail.error} retry={() => void detail.refetch()} />
      ) : (
        <PageSkeleton cards={3} />
      )}
    </Screen>
  );
}

/**
 * The read itself failed and there is nothing cached to draw. A refusal is
 * the server's sentence (404 is "this task is not yours"); no connection is
 * the connection line. A refetch that fails while data is on screen never
 * lands here — the stale detail stays up, which is what a driver in a
 * basement needs.
 */
function LoadFailed({ error, retry }: { error: unknown; retry: () => void }) {
  const message =
    error instanceof ApiRequestError
      ? error.message
      : error instanceof NetworkError
        ? error.message
        : TRANSPORT_FALLBACK;
  return (
    <EmptyState
      testID="task-load-failed"
      icon={<TriangleAlert size={32} color="#58687e" />}
      title="Couldn't open this job"
      description={message}
      action={
        <Button variant="outline" testID="task-retry" onPress={retry}>
          Try again
        </Button>
      }
    />
  );
}

/* --- verification: the guided visit ---------------------------------- */

function VerificationScreen({
  detail,
  refetch,
  refreshing,
}: {
  detail: VisitDetail;
  refetch: () => Promise<unknown>;
  refreshing: boolean;
}) {
  const { booking, task, bags, timeline, actionability, cancellation, tz } = detail;

  /*
   * IS THIS STILL A JOB? Asked of the actionability read, which is where
   * that question is answered for every other surface — not of a status
   * array here. `terminal` is `cancelled` or `completed`: nothing is going
   * to happen at this door again.
   */
  const stopped = actionability.standing === "terminal";
  const done = task.status === "done";
  const exception = booking.status === "exception" || task.status === "failed";
  const paymentCleared =
    detail.paymentStatus === "authorized" || detail.paymentStatus === "captured";

  return (
    <>
      {/* The web's sr-only h1: off-screen for sight, a heading for a reader. */}
      <Text
        accessibilityRole="header"
        className="absolute h-px w-px overflow-hidden opacity-0"
      >
        Verify and seal for {booking.paxName}, booking {booking.ref}
      </Text>

      {/* A stopped job says so in its own card below, so the gate's banner
          would only be a second sentence saying the same thing. */}
      {!stopped ? <ActionabilityNotice state={actionability} /> : null}

      <DoorstepCard context={detail} actionable={!stopped} />

      {/* A payment that has not cleared is a reason to stop before touching
          anyone's luggage, so it is a banner rather than a chip in a heading. */}
      {!paymentCleared && !stopped ? (
        <Card
          testID="payment-warning"
          className="flex-row items-start gap-3 border-warning/50 bg-warning/5 p-4"
        >
          <View className="mt-0.5">
            <TriangleAlert size={20} color="#152337" />
          </View>
          <Text className="flex-1 text-sm text-foreground">
            <Text weight="medium" className="text-sm text-foreground">
              Payment has not cleared.
            </Text>{" "}
            Check with ops before collecting these bags.
          </Text>
        </Card>
      ) : null}
      {paymentCleared && !stopped ? (
        <View testID="payment-paid" className="flex-row items-center gap-2 px-1">
          <Badge variant="success">Paid</Badge>
          <Text className="text-xs text-muted-foreground">This booking is paid for.</Text>
        </View>
      ) : null}

      {stopped ? (
        <TaskStopped
          kind="verification"
          reason={actionability.blockedReason}
          cancellation={cancellation}
          tz={tz}
        />
      ) : null}
      {/* ONE VIEW, TWO MODES. A finished or flagged visit renders its record
          instead of its controls — same screen, same doorstep card above. */}
      {stopped || done || exception ? (
        <TaskRecord
          kind="verification"
          bookingRef={booking.ref}
          bags={bags}
          timeline={timeline}
          tz={tz}
          outcome={stopped ? "stopped" : exception ? "exception" : "clean"}
        />
      ) : (
        <VisitFlow
          detail={detail}
          onRefresh={() => void refetch()}
          refreshing={refreshing}
        />
      )}
    </>
  );
}

/* --- collect & deliver: the guided pickup run ------------------------- */

function PickupScreen({
  detail,
  taskId,
  refetch,
}: {
  detail: PickupDetail;
  taskId: string;
  refetch: () => Promise<unknown>;
}) {
  const { booking, task, bags, timeline, actionability, cancellation, tz } = detail;
  const stopped = actionability.standing === "terminal";
  const done = task.status === "done";
  const exception = booking.status === "exception" || task.status === "failed";

  return (
    <>
      <Text
        accessibilityRole="header"
        face="display"
        weight="semibold"
        className="text-2xl text-navy-800"
      >
        Collect & deliver
      </Text>
      {!stopped ? <ActionabilityNotice state={actionability} /> : null}
      {/* The same doorstep card as the verification visit — a driver
          arriving for the pickup needs exactly what a driver arriving for
          the visit needed. */}
      <DoorstepCard context={detail} actionable={!stopped} />
      {stopped ? (
        <TaskStopped
          kind="pickup"
          reason={actionability.blockedReason}
          cancellation={cancellation}
          tz={tz}
        />
      ) : null}
      {stopped || done || exception ? (
        <TaskRecord
          kind="pickup"
          bookingRef={booking.ref}
          bags={bags}
          timeline={timeline}
          tz={tz}
          outcome={stopped ? "stopped" : exception ? "exception" : "clean"}
        />
      ) : (
        <PickupFlowScreen detail={detail} taskId={taskId} refetch={refetch} />
      )}
    </>
  );
}

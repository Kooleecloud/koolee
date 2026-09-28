import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TaskKind } from "@koolee/api-contract";

import { useSession } from "@/auth/session";
import { taskDetailKey } from "@/components/task/task-query";
import { useToast } from "@/components/ui";
import { keys } from "@/lib/queries";
import { supabase } from "@/lib/supabase";

import {
  useAnnounceChange,
  useBookingSignal,
  type BookingSignalStatus,
} from "./booking-signal";

/**
 * Live task views — the web agent app's `LiveTasks`, as two hooks.
 *
 * THE LIST: every booking the driver is assigned, watched from the tab
 * layout (mounted once, under every screen), so a job assigned mid-shift
 * appears on Today and Schedule without a pull. The ids come from the list
 * itself; one assigned in the last moments is not in the filter yet, and
 * the next read — Today's poll, a push, a return to the app — puts it there.
 *
 * THE TASK: the one booking on screen, so the identity gate opens in front
 * of the driver when the customer accepts the agreement at the door, and a
 * cancellation flips the screen live. Off once the job has stopped.
 *
 * A phone in a pocket is not being watched, so these announce MORE than the
 * customer page does: every one is something that changes what the driver
 * does next. Same sentences as the web.
 */
const ANNOUNCEMENTS: Record<string, string> = {
  "gate:open": "Identity confirmed — you can seal the bags now.",
  "pickup:mine": "This pickup is yours — the customer picked you.",
};

export function useLiveTaskList({
  bookingIds,
  jobCount,
}: {
  bookingIds: readonly string[];
  /** Null until the list has loaded — nothing to compare against yet. */
  jobCount: number | null;
}): BookingSignalStatus {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useSignedInUserId();

  const status = useBookingSignal({
    client: supabase,
    bookingIds,
    ignoreTouchedBy: me,
    onSignal: () => void qc.invalidateQueries({ queryKey: keys.tasks }),
    // Today polls every 30 s while it is showing and Schedule reads on
    // focus; a second timer here would only double the requests.
    pollMs: 0,
  });

  useAnnounceChange(jobCount === null ? null : `jobs:${jobCount}`, (next, previous) => {
    const added = Number(next.slice(5)) - Number(previous.slice(5));
    if (added > 0) {
      toast.success(
        added === 1 ? "New job assigned to you." : `${added} new jobs assigned to you.`,
      );
    }
  });

  return status;
}

export function useLiveTask({
  taskId,
  kind,
  bookingId,
  stage,
  enabled,
}: {
  taskId: string;
  kind: TaskKind;
  bookingId: string;
  /** Opaque milestone key: `gate:open`, `pickup:mine`, … */
  stage: string | null;
  enabled: boolean;
}): BookingSignalStatus {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useSignedInUserId();
  const bookingIds = React.useMemo(() => [bookingId], [bookingId]);

  const status = useBookingSignal({
    client: supabase,
    bookingIds,
    ignoreTouchedBy: me,
    onSignal: () => {
      void qc.invalidateQueries({ queryKey: taskDetailKey(taskId, kind) });
      void qc.invalidateQueries({ queryKey: keys.tasks });
    },
    enabled,
  });

  useAnnounceChange(enabled ? stage : null, (next) => {
    const message = ANNOUNCEMENTS[next];
    if (message) toast.success(message);
  });

  return status;
}

function useSignedInUserId(): string | null {
  const { state } = useSession();
  return state.status === "signed_in" ? state.me.userId : null;
}

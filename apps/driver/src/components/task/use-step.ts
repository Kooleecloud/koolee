import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import type { TaskKind } from "@koolee/api-contract";

import { useToast } from "@/components/ui";
import { ApiRequestError, NetworkError, TRANSPORT_FALLBACK } from "@/lib/api";
import { CameraPermissionError, PhotoError } from "@/lib/photos";
import {
  onQueueChange,
  runStep,
  type RunStepInput,
  type RunStepResult,
} from "@/offline/actions";

import { useInvalidateTask } from "./task-query";

/** What the driver reads when a step could not be sent right now. */
export const QUEUED_COPY = "Saved — will send when you have signal.";

/**
 * A step of a flow, as a mutation: `runStep` (which queues an offline tap)
 * plus the refetch every step owes the screen and the toast a queued one
 * owes the driver. Each step component holds its own so `isPending` and
 * `error` belong to the button that was pressed and no other.
 *
 * A QUEUED RESULT IS NOT FOREVER. The screens read `data.queued` to hold the
 * button, so a second tap cannot queue the same step twice. That hold has to
 * lift once the queue has moved on — the replay landed the step (and the
 * refetch folds it away), or the server refused it at replay (a toast said
 * so, and the driver needs the button back to try again). The queue reports
 * its count on every enqueue and after every replay; enqueues only raise it,
 * so a count that DROPS means a replay removed a row, and that is when the
 * queued result is released. Without this, a seal the server refused at
 * replay left "Record seal" disabled until the driver left the screen.
 */
export function useStep(taskId: string, kind: TaskKind) {
  const invalidate = useInvalidateTask(taskId, kind);
  const toast = useToast();
  const mutation = useMutation<RunStepResult, unknown, RunStepInput>({
    mutationFn: (input) => runStep(input),
    onSuccess: async (result) => {
      if (result.queued) toast.info(QUEUED_COPY);
      await invalidate();
    },
  });

  // `enqueueAction` notifies (count up) BEFORE `runStep` resolves, so by the
  // time `data.queued` is true the latest count already includes this row.
  const queued = mutation.data?.queued === true;
  const latestCount = React.useRef<number | null>(null);
  const reset = mutation.reset;
  React.useEffect(
    () =>
      onQueueChange((count) => {
        const before = latestCount.current;
        latestCount.current = count;
        if (queued && before !== null && count < before) reset();
      }),
    [queued, reset],
  );

  return mutation;
}

/**
 * The sentence for a step that did not land. A server refusal is shown
 * verbatim — the contract makes `message` safe — and so is anything the
 * photo pipeline said; a transport failure that escaped the queue (the
 * detail refetch, say) gets the connection line. Nothing is swallowed: an
 * unknown error still gets a sentence, just not one that pretends to know.
 */
export function stepErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof NetworkError) return error.message;
  if (error instanceof PhotoError || error instanceof CameraPermissionError)
    return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return TRANSPORT_FALLBACK;
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRoutes, taskDetailResponseSchema, type TaskKind } from "@koolee/api-contract";

import { apiFetch } from "@/lib/api";
import { keys } from "@/lib/queries";

/**
 * The task detail read, and the one key for it.
 *
 * Lives beside the screen rather than in `lib/queries` because the key is
 * per task AND per kind: the same task id answers differently to
 * `?kind=verification` and `?kind=pickup`, and a cache entry keyed on the id
 * alone would hand the pickup screen a visit.
 */
export function taskDetailKey(taskId: string, kind: TaskKind) {
  return ["task", taskId, kind] as const;
}

export function useTaskDetail(taskId: string, kind: TaskKind) {
  return useQuery({
    queryKey: taskDetailKey(taskId, kind),
    queryFn: () => apiFetch(taskDetailResponseSchema, apiRoutes.task(taskId, kind)),
    enabled: taskId.length > 0,
  });
}

/**
 * What every step does after the server said yes: the list first (a step
 * moves the job between Today's sections), then this task. Invalidation
 * refetches the mounted queries, so the flow re-renders from server state
 * rather than from what the screen assumed happened.
 */
export function useInvalidateTask(taskId: string, kind: TaskKind) {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: keys.tasks });
    await qc.invalidateQueries({ queryKey: taskDetailKey(taskId, kind) });
  };
}

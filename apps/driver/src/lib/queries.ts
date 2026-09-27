import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiRoutes,
  assignedTasksResponseSchema,
  okSchema,
  shiftResponseSchema,
  trucksResponseSchema,
} from "@koolee/api-contract";

import { apiFetch } from "./api";

/**
 * Server state, through TanStack Query. Keys are the route names; a mutation
 * invalidates what it changed and the session's `/me` is refreshed by the
 * caller, because a shift is part of the identity the header shows.
 */
export const keys = {
  shift: ["shift"] as const,
  trucks: ["trucks"] as const,
  tasks: ["tasks"] as const,
};

export function useShift() {
  return useQuery({
    queryKey: keys.shift,
    queryFn: () => apiFetch(shiftResponseSchema, apiRoutes.shift()),
  });
}

export function useTrucks(enabled = true) {
  return useQuery({
    queryKey: keys.trucks,
    queryFn: () => apiFetch(trucksResponseSchema, apiRoutes.trucks()),
    enabled,
  });
}

export function useTasks() {
  return useQuery({
    queryKey: keys.tasks,
    queryFn: () => apiFetch(assignedTasksResponseSchema, apiRoutes.tasks()),
  });
}

export function useStartShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (truckId: string) =>
      apiFetch(shiftResponseSchema, apiRoutes.shiftStart(), {
        method: "POST",
        body: { truckId },
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.shift });
      void qc.invalidateQueries({ queryKey: keys.trucks });
    },
  });
}

export function useEndShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch(okSchema, apiRoutes.shiftEnd(), {
        method: "POST",
        body: {},
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.shift });
      void qc.invalidateQueries({ queryKey: keys.trucks });
    },
  });
}

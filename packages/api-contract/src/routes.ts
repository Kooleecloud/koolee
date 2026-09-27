import { API_PREFIX } from "./common";
import type { TaskKind } from "./tasks";

/**
 * Every `/api/v1` path, built in one place so the app and the tests never
 * spell one differently from the route file that serves it.
 */
export const apiRoutes = {
  me: () => `${API_PREFIX}/me`,
  shift: () => `${API_PREFIX}/shift`,
  shiftStart: () => `${API_PREFIX}/shift/start`,
  shiftEnd: () => `${API_PREFIX}/shift/end`,
  trucks: () => `${API_PREFIX}/trucks`,
  tasks: () => `${API_PREFIX}/tasks`,
  task: (taskId: string, kind: TaskKind) =>
    `${API_PREFIX}/tasks/${encodeURIComponent(taskId)}?kind=${kind}`,
  visit: {
    arrive: (taskId: string) => `${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/visit/arrive`,
    capturePassport: (taskId: string) =>
      `${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/visit/capture-passport`,
    confirmPassport: (taskId: string) =>
      `${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/visit/confirm-passport`,
    sealBag: (taskId: string) =>
      `${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/visit/seal-bag`,
    complete: (taskId: string) =>
      `${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/visit/complete`,
    exception: (taskId: string) =>
      `${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/visit/exception`,
  },
  pickup: {
    start: (taskId: string) => `${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/pickup/start`,
    scanSeal: (taskId: string) =>
      `${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/pickup/scan-seal`,
    deliver: (taskId: string) =>
      `${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/pickup/deliver`,
    handover: (taskId: string) =>
      `${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/pickup/handover`,
    exception: (taskId: string) =>
      `${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/pickup/exception`,
  },
  positions: () => `${API_PREFIX}/positions`,
  accountAvatar: () => `${API_PREFIX}/account/avatar`,
} as const;

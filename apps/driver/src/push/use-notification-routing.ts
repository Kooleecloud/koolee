import * as React from "react";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  apiRoutes,
  assignedTasksResponseSchema,
  type AssignedTasksResponse,
} from "@koolee/api-contract";

import { apiFetch } from "@/lib/api";
import { keys } from "@/lib/queries";

import { destinationOf, kindFromTasks } from "./destination";

/**
 * What a notification does to the app. Mounted once, in the tab layout —
 * signed in, and under every screen.
 *
 * A TAP opens where the notification points: the task (kind from the tag,
 * else from the driver's own list), Today for the location nudge, Account
 * for the test push. The tap that LAUNCHED the app is read once at mount and
 * then cleared, so a later remount (sign out, sign in) does not replay it.
 *
 * A PUSH WHILE OPEN refetches the list. It is almost always "a job was
 * assigned to you", and the socket may not be watching that booking yet.
 */
export function useNotificationRouting(): void {
  const router = useRouter();
  const qc = useQueryClient();
  const handled = React.useRef(new Set<string>());

  React.useEffect(() => {
    let cancelled = false;

    const open = async (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handled.current.has(id)) return;
      handled.current.add(id);

      const destination = destinationOf(response.notification.request.content.data);
      if (!destination || cancelled) return;
      if (destination.screen === "today") {
        router.navigate("/(tabs)");
        return;
      }
      if (destination.screen === "account") {
        router.navigate("/(tabs)/account");
        return;
      }

      let kind = destination.kind;
      if (!kind) {
        const tasks = await qc
          .fetchQuery<AssignedTasksResponse>({
            queryKey: keys.tasks,
            queryFn: () => apiFetch(assignedTasksResponseSchema, apiRoutes.tasks()),
          })
          .catch(() => undefined);
        // Not in the list: not this driver's job. The screen's own read says
        // so in the server's words, whichever kind it asks with.
        kind = kindFromTasks(destination.taskId, tasks) ?? "verification";
      }
      if (cancelled) return;
      router.push({
        pathname: "/task/[taskId]",
        params: { taskId: destination.taskId, kind },
      });
    };

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response || cancelled) return;
      void Notifications.clearLastNotificationResponseAsync();
      void open(response);
    });
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      void open(response);
    });
    const received = Notifications.addNotificationReceivedListener(() => {
      void qc.invalidateQueries({ queryKey: keys.tasks });
    });

    return () => {
      cancelled = true;
      tapped.remove();
      received.remove();
    };
  }, [router, qc]);
}

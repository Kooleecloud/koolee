import type { AssignedTasksResponse, TaskKind } from "@koolee/api-contract";

/**
 * Where a tapped notification lands.
 *
 * The server sends the web agent app's payload unchanged (one fan-out, two
 * channels): a `url` that is a web deep link, `/tasks/<id>` — kind-less on
 * purpose, the web page resolves a pickup first and falls back to the visit —
 * and a collapse `tag` that DOES name the kind: `pickup-task:<id>`,
 * `verification-task:<id>`. The tag wins; the url is the fallback, and then
 * the kind comes from the driver's own task list.
 *
 * Two tags carry no task: the location nudge (`position-gap:…`) lands on
 * Today, where the shift card restarts tracking, and the Account tab's test
 * push (`push-test:…`) lands back on Account.
 */
export type NotificationDestination =
  | { screen: "task"; taskId: string; kind: TaskKind | null }
  | { screen: "today" }
  | { screen: "account" };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const TASK_TAG = new RegExp(`^(pickup|verification)-task:(${UUID})$`, "i");
const TASK_PATH = new RegExp(`/tasks/(${UUID})(?:[/?#]|$)`, "i");

function stringField(data: unknown, key: string): string | null {
  if (typeof data !== "object" || data === null) return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export function destinationOf(data: unknown): NotificationDestination | null {
  const tag = stringField(data, "tag");
  const tagged = tag ? TASK_TAG.exec(tag) : null;
  if (tagged) {
    const kind: TaskKind =
      tagged[1]!.toLowerCase() === "pickup" ? "pickup" : "verification";
    return { screen: "task", taskId: tagged[2]!.toLowerCase(), kind };
  }

  const url = stringField(data, "url");
  const linked = url ? TASK_PATH.exec(url) : null;
  if (linked) return { screen: "task", taskId: linked[1]!.toLowerCase(), kind: null };

  if (tag?.startsWith("position-gap:")) return { screen: "today" };
  if (tag?.startsWith("push-test:")) return { screen: "account" };
  return null;
}

/**
 * The kind of a task id, from the assigned list. Null when the id is not in
 * it — the task is not this driver's (any more), and the screen's own read
 * will say so in the server's words.
 */
export function kindFromTasks(
  taskId: string,
  tasks: AssignedTasksResponse | undefined,
): TaskKind | null {
  if (!tasks) return null;
  if (tasks.pickup.some((row) => row.task.id === taskId)) return "pickup";
  if (tasks.verification.some((row) => row.task.id === taskId)) return "verification";
  return null;
}

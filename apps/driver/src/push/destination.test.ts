import { describe, expect, it } from "vitest";
import type { AssignedTasksResponse } from "@koolee/api-contract";

import { destinationOf, kindFromTasks } from "./destination";

const TASK = "b065175d-017b-47e9-b4b2-3462550f1b6e";
const VISIT = "2da77f80-9a4c-41f7-8932-7bbe422e7191";

describe("destinationOf", () => {
  it("takes the kind from a task tag — what the server's job pushes carry", () => {
    expect(
      destinationOf({
        tag: `pickup-task:${TASK}`,
        url: `https://agent.test/tasks/${TASK}`,
      }),
    ).toEqual({ screen: "task", taskId: TASK, kind: "pickup" });
    expect(destinationOf({ tag: `verification-task:${VISIT}` })).toEqual({
      screen: "task",
      taskId: VISIT,
      kind: "verification",
    });
  });

  it("falls back to the web deep link, leaving the kind to the task list", () => {
    expect(
      destinationOf({ tag: "pickup:booking", url: `https://agent.test/tasks/${TASK}` }),
    ).toEqual({ screen: "task", taskId: TASK, kind: null });
    expect(destinationOf({ url: `/tasks/${TASK}?from=push` })).toEqual({
      screen: "task",
      taskId: TASK,
      kind: null,
    });
  });

  it("sends the location nudge to Today and the test push to Account", () => {
    expect(destinationOf({ tag: "position-gap:shift-1:12345" })).toEqual({
      screen: "today",
    });
    expect(destinationOf({ tag: "push-test:1790000000000" })).toEqual({
      screen: "account",
    });
  });

  it("ignores anything else rather than guessing", () => {
    expect(destinationOf(null)).toBeNull();
    expect(destinationOf("pickup-task:x")).toBeNull();
    expect(destinationOf({ tag: "pickup-task:not-a-uuid" })).toBeNull();
    expect(destinationOf({ url: "https://agent.test/tasks/undefined" })).toBeNull();
    expect(destinationOf({ tag: 42, url: ["x"] })).toBeNull();
  });
});

describe("kindFromTasks", () => {
  const tasks = {
    verification: [{ task: { id: VISIT } }],
    pickup: [{ task: { id: TASK } }],
    serverTime: "2026-09-27T12:00:00.000Z",
  } as unknown as AssignedTasksResponse;

  it("finds the kind of an assigned task", () => {
    expect(kindFromTasks(TASK, tasks)).toBe("pickup");
    expect(kindFromTasks(VISIT, tasks)).toBe("verification");
  });

  it("says null for a task that is not this driver's, or with no list yet", () => {
    expect(kindFromTasks("00000000-0000-4000-8000-000000000000", tasks)).toBeNull();
    expect(kindFromTasks(TASK, undefined)).toBeNull();
  });
});

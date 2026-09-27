import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { API_PREFIX, apiRoutes } from "@koolee/api-contract";

/**
 * Static inventory: every path the contract can build must be served by a
 * route file under this directory, exporting the method the app will use
 * and opting out of caching. A path added to `apiRoutes` without a route
 * file fails here by name, before anyone installs a build that 404s.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TASK_ID = "__taskId__";

/** Read routes; everything else is a POST. `accountAvatar` and `pushRegister` also serve DELETE. */
const GET_ROUTES = new Set(["me", "shift", "trucks", "tasks", "task"]);
const DELETE_ROUTES = new Set(["accountAvatar", "pushRegister"]);

type RouteFn = (...args: never[]) => string;

interface RouteEntry {
  name: string;
  file: string;
  methods: string[];
}

function flatten(node: Record<string, unknown>, prefix = ""): RouteEntry[] {
  const entries: RouteEntry[] = [];
  for (const [key, value] of Object.entries(node)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "function") {
      // Every builder takes a task id first (or nothing); the second
      // argument is only `task`'s kind, which becomes a query string.
      const url = (value as RouteFn)(...([TASK_ID, "pickup"] as never[]));
      const pathname = url.split("?")[0] ?? url;
      expect(pathname.startsWith(`${API_PREFIX}/`)).toBe(true);
      const relative = pathname
        .slice(API_PREFIX.length + 1)
        .replaceAll(TASK_ID, "[taskId]");
      const methods = [GET_ROUTES.has(key) ? "GET" : "POST"];
      if (DELETE_ROUTES.has(key)) methods.push("DELETE");
      entries.push({ name, file: path.join(HERE, relative, "route.ts"), methods });
    } else if (value && typeof value === "object") {
      entries.push(...flatten(value as Record<string, unknown>, name));
    }
  }
  return entries;
}

const ENTRIES = flatten(apiRoutes);

describe("api/v1 route inventory", () => {
  it("covers every path the contract can build", () => {
    expect(ENTRIES.map((e) => e.name).sort()).toEqual(
      [
        "accountAvatar",
        "me",
        "pickup.deliver",
        "pickup.exception",
        "pickup.handover",
        "pickup.scanSeal",
        "pickup.start",
        "positions",
        "pushRegister",
        "pushTest",
        "shift",
        "shiftEnd",
        "shiftStart",
        "task",
        "tasks",
        "trucks",
        "visit.arrive",
        "visit.capturePassport",
        "visit.complete",
        "visit.confirmPassport",
        "visit.exception",
        "visit.sealBag",
      ].sort(),
    );
  });

  describe.each(ENTRIES)("$name → $file", ({ file, methods }) => {
    it("has a route file on disk", () => {
      expect(existsSync(file), `missing route file: ${path.relative(HERE, file)}`).toBe(
        true,
      );
    });

    it(`exports ${methods.join(" + ")} and dynamic = "force-dynamic"`, async () => {
      if (!existsSync(file)) return; // reported by the test above; keep this one readable
      const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
      for (const method of methods) {
        expect(typeof mod[method], `${method} export`).toBe("function");
      }
      expect(mod.dynamic).toBe("force-dynamic");
    });
  });
});

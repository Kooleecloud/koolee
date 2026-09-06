import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A component that calls a hook must declare `"use client"`.
 *
 * `Avatar` did not, and server components render it directly — the staff
 * table, the agent's visit screen, the customer's trip page. Every one of
 * those routes is `force-dynamic`, so `next build` never prerendered them and
 * never executed the component; the build passed and the pages threw
 * "useState only works in Client Components" the moment anybody opened them.
 * Typecheck, lint, a full test run and Storybook screenshots were all green
 * (Storybook renders client-side, where hooks are always fine).
 *
 * `markdown.tsx` had the same omission and never fired only because its one
 * caller happens to be a client component — a trap set for whoever server-
 * rendered an agreement body first.
 *
 * So the rule is asserted here rather than left to whether a page happens to
 * get opened before release.
 *
 * `src/lib` is scanned too, and not as an afterthought: hooks live there as
 * well (`use-preserved-form.ts`, `booking-signal.ts`), they are exported from
 * the same barrel a server component imports, and the failure mode is
 * identical — green build, runtime explosion on first open.
 */

const componentsDir = dirname(fileURLToPath(import.meta.url));
const libDir = join(componentsDir, "..", "lib");

const HOOK =
  /\buse(?:State|Effect|LayoutEffect|Ref|Memo|Callback|Context|Reducer|Transition|DeferredValue|Id|ActionState|OptimisticState|SyncExternalStore)\s*[(<]/;

const componentFiles = readdirSync(componentsDir)
  .filter((name) => name.endsWith(".tsx") && !name.endsWith(".stories.tsx"))
  .sort()
  .map((name) => ({ label: `components/${name}`, path: join(componentsDir, name) }));

const libFiles = readdirSync(libDir)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .sort()
  .map((name) => ({ label: `lib/${name}`, path: join(libDir, name) }));

const sourceFiles = [...componentFiles, ...libFiles];

describe("client directive", () => {
  it("finds the component files", () => {
    // Guards the guard: a bad glob would make every assertion below vacuous.
    expect(componentFiles.length).toBeGreaterThan(20);
    expect(libFiles.length).toBeGreaterThan(3);
  });

  it.each(sourceFiles.map((f) => [f.label, f.path]))(
    "%s declares 'use client' if it uses hooks",
    (name, filePath) => {
      const source = readFileSync(filePath, "utf8");
      if (!HOOK.test(source)) return;

      // The directive must be the very first statement — a comment above it is
      // fine, but any import before it and the bundler ignores it entirely.
      const firstCode = source
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0 && !line.startsWith("//"));

      expect(firstCode, `${name} calls a React hook`).toBe('"use client";');
    },
  );
});

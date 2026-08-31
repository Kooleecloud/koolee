import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The push kill switch. **Push ships DISABLED**, in every environment.
 *
 * Two things have to hold, and they are checked separately because they fail
 * separately: the flag must default to OFF, and the surface a person sees
 * must actually consult it.
 *
 * The second is a SOURCE assertion, the same technique
 * `packages/ui/src/components/client-directive.test.ts` uses. These app suites
 * run in a node environment with no DOM, no JSX loader and no `@/` alias, so
 * importing the component is not available here — and the property worth
 * pinning is "the gate exists", which the source states plainly. Rendering is
 * covered by the browser pass in RUN-REPORT-10.
 *
 * Why the default matters more than it looks: the browser's permission prompt
 * is ONE-SHOT. Offering to enable a channel the server will not send on spends
 * it on a feature that cannot work, and no later moment gets it back.
 */

const here = dirname(fileURLToPath(import.meta.url));

describe("push kill switch — default OFF", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const flagIs = async (value: string | undefined) => {
    vi.stubEnv("NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED", value ?? "");
    vi.resetModules();
    const { pushNotificationsEnabled } = await import("./env");
    return pushNotificationsEnabled();
  };

  it("is OFF when the flag is unset", async () => {
    expect(await flagIs(undefined)).toBe(false);
  });

  it("is OFF when the flag is explicitly false", async () => {
    expect(await flagIs("false")).toBe(false);
  });

  it('is OFF for anything that is not exactly "true"', async () => {
    // A typo must fail CLOSED. "yes"/"1"/"TRUE" enabling a silent channel by
    // accident is the outcome this default exists to prevent.
    expect(await flagIs("yes")).toBe(false);
    expect(await flagIs("1")).toBe(false);
    expect(await flagIs("TRUE")).toBe(false);
  });

  it('is ON only for exactly "true"', async () => {
    expect(await flagIs("true")).toBe(true);
  });

  it("the enable affordance consults the flag and renders nothing when off", () => {
    const source = readFileSync(join(here, "app/notifications-card.tsx"), "utf8");
    expect(source).toContain("pushNotificationsEnabled");
    expect(source).toMatch(/if\s*\(!pushNotificationsEnabled\(\)\)\s*return null;/);
  });
});

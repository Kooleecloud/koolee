import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The push kill switch in the customer app. **Push ships DISABLED.**
 *
 * Two properties, checked separately because they fail separately: the flag
 * defaults to OFF, and the trip page actually consults it before rendering
 * the pickup-day prompt. The second is a SOURCE assertion, the technique
 * `packages/ui/src/components/client-directive.test.ts` established, because
 * this suite has no DOM and the property worth pinning is "the gate exists".
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

  it('is OFF when unset, and OFF for anything but exactly "true"', async () => {
    expect(await flagIs(undefined)).toBe(false);
    expect(await flagIs("false")).toBe(false);
    // A typo must fail CLOSED.
    expect(await flagIs("yes")).toBe(false);
    expect(await flagIs("TRUE")).toBe(false);
  });

  it('is ON only for exactly "true"', async () => {
    expect(await flagIs("true")).toBe(true);
  });

  it("the trip page gates the pickup-day prompt on the flag", () => {
    const source = readFileSync(join(here, "app/trips/[bookingId]/page.tsx"), "utf8");
    expect(source).toContain("pushNotificationsEnabled()");
    // The flag is the FIRST term, so nothing else has to be evaluated to know
    // the card is off.
    expect(source).toMatch(/\{pushNotificationsEnabled\(\) &&\s*\n\s*isActive &&/);
  });
});

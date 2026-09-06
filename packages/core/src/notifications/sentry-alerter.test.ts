import { describe, expect, it, vi } from "vitest";

import { SentryOpsAlerter } from "./sentry-alerter";

function silentLogger() {
  return { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
}

describe("SentryOpsAlerter", () => {
  it("captures with the mapped level and the title as the message", async () => {
    const capture = vi.fn();
    const logger = silentLogger();
    await new SentryOpsAlerter({ capture, logger }).alert({
      severity: "critical",
      title: "Payment capture failed for booking b-1",
    });

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Payment capture failed for booking b-1",
        level: "fatal",
      }),
    );
  });

  it("promotes a booking ref and id out of the detail into tags", async () => {
    const capture = vi.fn();
    await new SentryOpsAlerter({ capture, logger: silentLogger() }).alert({
      severity: "warning",
      title: "Confirmation email failed",
      detail: { bookingRef: "KOO-7QK2M", bookingId: "b-1", attempt: 3 },
    });

    const [event] = capture.mock.calls[0]!;
    expect(event.tags).toEqual({ booking_ref: "KOO-7QK2M", booking_id: "b-1" });
    // The whole detail still rides along — the tags are for searching, the
    // extra is for reading.
    expect(event.extra).toEqual({
      bookingRef: "KOO-7QK2M",
      bookingId: "b-1",
      attempt: 3,
    });
  });

  it("logs to the console as well, at the matching level", async () => {
    const logger = silentLogger();
    const alerter = new SentryOpsAlerter({ capture: vi.fn(), logger });

    await alerter.alert({ severity: "critical", title: "c" });
    await alerter.alert({ severity: "warning", title: "w" });
    await alerter.alert({ severity: "info", title: "i" });

    // The console line is the record that survives a dead transport, a
    // rate limit, and an unconfigured DSN. Same `[ops:…]` prefix
    // `ConsoleOpsAlerter` uses, so nothing grepping logs learns a second
    // format.
    expect(logger.error).toHaveBeenCalledWith("[ops:critical] c", {});
    expect(logger.warn).toHaveBeenCalledWith("[ops:warning] w", {});
    expect(logger.log).toHaveBeenCalledWith("[ops:info] i", {});
  });

  /**
   * THE RULE THIS CLASS EXISTS TO KEEP. Twelve of the seventeen
   * `opsAlerter.alert` call sites are in the jobs layer and are NOT wrapped in
   * a try/catch — an alerter that throws there fails the Inngest step and
   * triggers a retry, turning "we could not tell ops about a failed email"
   * into "the email function is now failing and retrying".
   */
  it("NEVER propagates a transport failure", async () => {
    const logger = silentLogger();
    const capture = vi.fn(() => {
      throw new Error("sentry is having a bad minute");
    });

    await expect(
      new SentryOpsAlerter({ capture, logger }).alert({
        severity: "critical",
        title: "No agent check-in for booking b-1",
      }),
    ).resolves.toBeUndefined();

    // …and the alert is still in the logs, because the console line is
    // written BEFORE the capture is attempted.
    expect(logger.error).toHaveBeenCalledWith(
      "[ops:critical] No agent check-in for booking b-1",
      {},
    );
    expect(logger.error).toHaveBeenCalledWith(
      "[ops] Sentry capture failed",
      expect.any(Error),
    );
  });

  it("omits `extra` entirely when there is no detail", async () => {
    const capture = vi.fn();
    await new SentryOpsAlerter({ capture, logger: silentLogger() }).alert({
      severity: "warning",
      title: "t",
    });
    expect(capture.mock.calls[0]![0]).not.toHaveProperty("extra");
  });
});

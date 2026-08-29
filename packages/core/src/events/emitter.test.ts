import { describe, expect, it, vi } from "vitest";

import { createCoreConfig } from "../config";
import { FakePaymentProvider } from "../payments/fake";
import { BOOKING_EXCEPTION_RAISED, emitExceptionRaised } from "./booking-events";
import { ConsoleEmitter, NoopEmitter, RecordingEmitter } from "./emitter";
import { createEventEmitter } from "./factory";

/** No database is touched here — the seam is a plain value. */
const fakeDb = {} as never;

describe("createEventEmitter", () => {
  it("selects console when asked, noop otherwise", () => {
    expect(createEventEmitter({ kind: "console" })).toBeInstanceOf(ConsoleEmitter);
    expect(createEventEmitter({ kind: "noop" })).toBeInstanceOf(NoopEmitter);
  });
});

describe("CoreConfig emitter default", () => {
  it("defaults to the noop emitter, so core is usable with no queue wiring", () => {
    const config = createCoreConfig({ db: fakeDb, payments: new FakePaymentProvider() });
    expect(config.emitter).toBeInstanceOf(NoopEmitter);
  });

  it("takes the injected emitter when one is given", () => {
    const emitter = new RecordingEmitter();
    const config = createCoreConfig({
      db: fakeDb,
      payments: new FakePaymentProvider(),
      emitter,
    });
    expect(config.emitter).toBe(emitter);
  });
});

describe("emitExceptionRaised", () => {
  it("keeps the wire name and payload shape the Inngest function consumes", async () => {
    const emitter = new RecordingEmitter();

    await emitExceptionRaised(emitter, {
      bookingId: "b-1",
      reason: "customer_not_home",
      dedupeKey: "ce-9",
      raisedByUserId: "u-7",
    });

    expect(emitter.emitted).toEqual([
      {
        name: "booking/exception_raised",
        id: "booking-exception:b-1:ce-9",
        data: {
          bookingId: "b-1",
          reason: "customer_not_home",
          raisedByUserId: "u-7",
        },
      },
    ]);
    expect(BOOKING_EXCEPTION_RAISED).toBe("booking/exception_raised");
  });

  it("omits raisedByUserId entirely for a system raise", async () => {
    const emitter = new RecordingEmitter();

    await emitExceptionRaised(emitter, {
      bookingId: "b-2",
      reason: "payment_capture_failed",
      dedupeKey: "ce-3",
    });

    expect(emitter.emitted[0]!.data).toEqual({
      bookingId: "b-2",
      reason: "payment_capture_failed",
    });
  });

  it("swallows and logs an emit failure — the caller's transition already committed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const emitter = {
      emit: () => Promise.reject(new Error("queue unreachable")),
    };

    await expect(
      emitExceptionRaised(emitter, {
        bookingId: "b-3",
        reason: "bags_refused",
        dedupeKey: "ce-4",
      }),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});

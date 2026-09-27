import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUCKETS,
  NotFoundError,
  getBookingActionability,
  getCancellation,
  getPickupContext,
  getVisitContext,
  listAssignedTasks,
  staffTravelToDoor,
  type BookingActionability,
  type PickupContext,
  type VisitContext,
} from "@koolee/core";
import {
  agreementAcceptanceSchema,
  agreementVersionSchema,
  assignedTasksResponseSchema,
  bookingSchema,
  passportVerificationSchema,
  taskBookingContextSchema,
  taskDetailResponseSchema,
  verificationTaskSchema,
} from "@koolee/api-contract";

import type * as core from "@koolee/core";

import type { ApiContext } from "../context";
import { readTaskDetail, readTasks } from "./tasks";

vi.mock("@koolee/core", async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  listAssignedTasks: vi.fn(),
  getVisitContext: vi.fn(),
  getPickupContext: vi.fn(),
  getBookingActionability: vi.fn(),
  getCancellation: vi.fn(),
  staffTravelToDoor: vi.fn(),
}));

/* ------------------------------------------------------------------ */
/* Fixtures — shaped like the rows core returns, dates as Dates         */
/* ------------------------------------------------------------------ */

const NOW = new Date("2026-09-27T12:00:00.000Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const BOOKING_ID = "33333333-3333-4333-8333-333333333333";
const TASK_ID = "44444444-4444-4444-8444-444444444444";
const BAG_ID = "55555555-5555-4555-8555-555555555555";
const EVENT_ID = "66666666-6666-4666-8666-666666666666";
const SHIFT_ID = "77777777-7777-4777-8777-777777777777";
const PASSPORT_ID = "88888888-8888-4888-8888-888888888888";
const VERSION_ID = "99999999-9999-4999-8999-999999999999";

const booking = {
  id: BOOKING_ID,
  ref: "KOO-ABC12",
  userId: CUSTOMER_ID,
  status: "agent_assigned",
  flightNumber: "DL123",
  airlineIata: "DL",
  departureAirport: "JFK",
  departureAt: new Date("2026-09-28T18:00:00.000Z"),
  destinationAirport: "LAX",
  paxName: "Ada Lovelace",
  pickupLine1: "22 W 34th St",
  pickupLine2: null,
  pickupCity: "New York",
  pickupState: "NY",
  pickupZip: "10001",
  pickupLat: 40.75,
  pickupLng: -73.99,
  pickupPlaceId: null,
  bagCount: 2,
  pickupWindowStart: new Date("2026-09-28T09:00:00.000Z"),
  pickupWindowEnd: new Date("2026-09-28T10:00:00.000Z"),
  displayTz: "America/New_York",
  contactPhone: null,
  // Columns the contract does not declare. Core returns the whole row; the
  // price and its breakdown must never reach a driver's phone.
  pickupAddressId: null,
  slotId: null,
  bookedFromTz: "Europe/London",
  priceCents: 12900,
  currency: "usd",
  priceBreakdown: { base: 9900, perBag: 1500 },
  createdAt: NOW,
  updatedAt: NOW,
};

/** Substrings that must not appear anywhere in a serialised response. */
const NEVER_ON_THE_WIRE = [
  "priceCents",
  "priceBreakdown",
  "bookedFromTz",
  "bodyMd",
  "publishedBy",
  "acceptedByUserId",
  "evidence",
  "203.0.113.9",
  "validityCheckProvider",
];

const task = {
  id: TASK_ID,
  bookingId: BOOKING_ID,
  assigneeUserId: USER_ID,
  status: "assigned",
  scheduledStart: new Date("2026-09-28T09:00:00.000Z"),
  scheduledEnd: new Date("2026-09-28T10:00:00.000Z"),
  startedAt: null,
  completedAt: null,
  notes: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const bag = {
  id: BAG_ID,
  bookingId: BOOKING_ID,
  ordinal: 1,
  sealId: null,
  weightKg: "12.50",
  photoUrls: [],
  createdAt: NOW,
  updatedAt: NOW,
};

const event = {
  id: EVENT_ID,
  bookingId: BOOKING_ID,
  bagId: null,
  actorUserId: USER_ID,
  actorRole: "agent",
  eventType: "visit.arrived",
  lat: null,
  lng: null,
  photoUrl: null,
  metadata: { note: "buzzer 4B" },
  createdAt: NOW,
};

const address = {
  line1: "22 W 34th St",
  line2: null,
  city: "New York",
  state: "NY",
  zip: "10001",
  lat: 40.75,
  lng: -73.99,
  placeId: null,
};

const customer = {
  fullName: "Ada L.",
  avatarStoragePath: `${CUSTOMER_ID}/avatar.jpg`,
  phone: "+13322602829",
};

const actionability: BookingActionability = {
  standing: "active",
  phase: "before_window_end",
  can: {
    acceptAgreement: true,
    uploadPassport: true,
    selectDriver: true,
    startVisit: true,
    startPickup: false,
  },
  blockedReason: null,
  lateNotice: null,
  raisesException: false,
  pickupWindowEnd: booking.pickupWindowEnd,
  bagDropCutoffAt: new Date("2026-09-28T17:00:00.000Z"),
  departureAt: booking.departureAt,
};

function visitContext(): VisitContext {
  return {
    task,
    booking,
    bags: [bag],
    timeline: [event],
    paymentStatus: "captured",
    address,
    tz: "America/New_York",
    customer,
    identityGate: {
      agreement: {
        acceptedVersion: {
          id: VERSION_ID,
          version: 3,
          title: "Terms",
          bodyMd: "# Terms\n\nThe entire agreement, which no task screen renders.",
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          publishedBy: null,
        },
        acceptance: {
          id: PASSPORT_ID,
          bookingId: BOOKING_ID,
          agreementVersionId: VERSION_ID,
          acceptedAt: NOW,
          acceptedByUserId: CUSTOMER_ID,
          // The customer's own evidence — theirs, not the driver's.
          evidence: { ip: "203.0.113.9", userAgent: "Safari" },
        },
        currentVersion: null,
        accepted: true,
      },
      passport: {
        id: PASSPORT_ID,
        bookingId: BOOKING_ID,
        status: "customer_uploaded",
        photoStoragePath: `passports/${BOOKING_ID}/photo.jpg`,
        uploadedAt: NOW,
        confirmedAt: null,
        confirmedByAgentId: null,
        validityCheckStatus: "not_checked",
        validityCheckProvider: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      passportConfirmed: false,
      blockers: ["passport_not_confirmed"],
      passed: false,
    },
  } as unknown as VisitContext;
}

function pickupContext(): PickupContext {
  return {
    task: { ...task, driverShiftId: SHIFT_ID },
    booking,
    bags: [bag],
    scannedBagIds: [BAG_ID],
    timeline: [event],
    tz: "America/New_York",
    address,
    customer,
    shift: { id: SHIFT_ID, truckName: "Van 2" },
  } as unknown as PickupContext;
}

/* ------------------------------------------------------------------ */
/* Fake context                                                         */
/* ------------------------------------------------------------------ */

const createSignedUrl = vi.fn();

function fakeCtx(): ApiContext {
  return {
    core: { db: {}, clock: { now: () => NOW } },
    session: { kind: "agent", role: "agent", userId: USER_ID },
    identity: {
      session: { kind: "agent", role: "agent", userId: USER_ID },
      email: "driver@example.com",
      fullName: "Driver",
      avatarStoragePath: null,
      canDrive: true,
    },
    supabase: { storage: { from: () => ({ createSignedUrl }) } },
    now: NOW,
  } as unknown as ApiContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  createSignedUrl.mockImplementation((path: string) =>
    Promise.resolve({ data: { signedUrl: `https://signed.test/${path}` }, error: null }),
  );
  vi.mocked(getBookingActionability).mockResolvedValue(actionability);
  vi.mocked(getCancellation).mockResolvedValue(null);
  vi.mocked(staffTravelToDoor).mockResolvedValue({
    distanceLabel: "3.2 miles away",
    etaLabel: "about 15 min",
    label: "3.2 miles away · about 15 min",
  });
});

/* ------------------------------------------------------------------ */
/* readTasks                                                            */
/* ------------------------------------------------------------------ */

describe("readTasks", () => {
  it("returns both queues with dates serialised, plus serverTime", async () => {
    vi.mocked(listAssignedTasks).mockResolvedValue({
      verification: [
        {
          task: { ...task, internalNote: "ops only" },
          tz: "America/New_York",
          booking: taskBooking(),
        },
      ],
      pickup: [
        {
          task: { ...task, driverShiftId: null },
          tz: "America/New_York",
          booking: taskBooking(),
        },
      ],
    } as never);

    const ctx = fakeCtx();
    const result = await readTasks(ctx);

    expect(listAssignedTasks).toHaveBeenCalledWith(ctx.core.db, USER_ID, NOW);
    const parsed = assignedTasksResponseSchema.parse(result);
    expect(parsed.serverTime).toBe(NOW.toISOString());
    expect(parsed.verification[0]?.task.scheduledStart).toBe("2026-09-28T09:00:00.000Z");
    expect(parsed.pickup[0]?.booking.bagDropCutoffAt).toBe("2026-09-28T17:00:00.000Z");
    // On the RAW result, not the parsed one: the server sends the declared
    // columns and nothing else, so nothing rides on the app's stripping.
    expect(Object.keys(result.verification[0]!.booking).sort()).toEqual(
      Object.keys(taskBookingContextSchema.shape).sort(),
    );
    expect(Object.keys(result.verification[0]!.task).sort()).toEqual(
      Object.keys(verificationTaskSchema.shape).sort(),
    );
    expect(result.pickup[0]!.task).toHaveProperty("driverShiftId", null);
    expect(result.verification[0]!.task).not.toHaveProperty("internalNote");
  });

  it("lets a core failure propagate rather than answering an empty list", async () => {
    vi.mocked(listAssignedTasks).mockRejectedValue(new Error("db down"));
    await expect(readTasks(fakeCtx())).rejects.toThrow("db down");
  });
});

function taskBooking() {
  return {
    id: BOOKING_ID,
    ref: "KOO-ABC12",
    paxName: "Ada Lovelace",
    flightNumber: "DL123",
    departureAirport: "JFK",
    departureAt: booking.departureAt,
    bagCount: 2,
    status: "agent_assigned",
    addressLine1: "22 W 34th St",
    addressLine2: null,
    addressCity: "New York",
    addressState: "NY",
    addressZip: "10001",
    addressLat: 40.75,
    addressLng: -73.99,
    addressPlaceId: null,
    contactPhone: null,
    customerPhone: "+13322602829",
    bagDropCutoffAt: new Date("2026-09-28T17:00:00.000Z"),
  };
}

/* ------------------------------------------------------------------ */
/* readTaskDetail — verification                                        */
/* ------------------------------------------------------------------ */

describe("readTaskDetail (verification)", () => {
  it("assembles a visit detail that satisfies the contract", async () => {
    vi.mocked(getVisitContext).mockResolvedValue(visitContext());
    const ctx = fakeCtx();

    const result = await readTaskDetail(ctx, TASK_ID, "verification");

    expect(getVisitContext).toHaveBeenCalledWith(ctx.core.db, ctx.session, TASK_ID, NOW);
    expect(getBookingActionability).toHaveBeenCalledWith(ctx.core.db, booking, NOW);
    expect(staffTravelToDoor).toHaveBeenCalledWith(ctx.core, {
      staffUserId: USER_ID,
      destination: { lat: 40.75, lng: -73.99 },
    });
    // Not terminal, so nobody asks who cancelled it.
    expect(getCancellation).not.toHaveBeenCalled();

    const parsed = taskDetailResponseSchema.parse(result);
    if (parsed.kind !== "verification") throw new Error("expected a visit");
    const { visit } = parsed;
    expect(visit.serverTime).toBe(NOW.toISOString());
    expect(visit.booking.departureAt).toBe("2026-09-28T18:00:00.000Z");
    expect(visit.paymentStatus).toBe("captured");
    expect(visit.identityGate.blockers).toEqual(["passport_not_confirmed"]);
    expect(visit.identityGate.agreement.acceptance?.acceptedAt).toBe(NOW.toISOString());
    expect(visit.travel?.label).toBe("3.2 miles away · about 15 min");
    expect(visit.cancellation).toBeNull();
    expect(visit.customerAvatarUrl).toBe(`https://signed.test/${CUSTOMER_ID}/avatar.jpg`);
    expect(visit.passportPhotoUrl).toBe(
      `https://signed.test/passports/${BOOKING_ID}/photo.jpg`,
    );
  });

  it("sends exactly the declared columns — the price, the agreement text and the customer's evidence stay on the server", async () => {
    vi.mocked(getVisitContext).mockResolvedValue(visitContext());

    const result = await readTaskDetail(fakeCtx(), TASK_ID, "verification");
    if (result.kind !== "verification") throw new Error("expected a visit");
    const { visit } = result;

    // Checked on the handler's own return value, BEFORE any zod parse: this
    // is what `NextResponse.json` would put on the wire.
    expect(Object.keys(visit.booking).sort()).toEqual(
      Object.keys(bookingSchema.shape).sort(),
    );
    expect(Object.keys(visit.identityGate.agreement.acceptedVersion!).sort()).toEqual(
      Object.keys(agreementVersionSchema.shape).sort(),
    );
    expect(Object.keys(visit.identityGate.agreement.acceptance!).sort()).toEqual(
      Object.keys(agreementAcceptanceSchema.shape).sort(),
    );
    expect(Object.keys(visit.identityGate.passport!).sort()).toEqual(
      Object.keys(passportVerificationSchema.shape).sort(),
    );
    const wire = JSON.stringify(result);
    for (const needle of NEVER_ON_THE_WIRE) expect(wire).not.toContain(needle);
    // And what IS declared survives the projection with its dates converted.
    expect(visit.identityGate.agreement.acceptedVersion?.effectiveFrom).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(visit.identityGate.passport?.uploadedAt).toBe(NOW.toISOString());
  });

  it("signs the avatar and the passport with their own buckets' TTLs", async () => {
    vi.mocked(getVisitContext).mockResolvedValue(visitContext());
    await readTaskDetail(fakeCtx(), TASK_ID, "verification");

    expect(createSignedUrl).toHaveBeenCalledWith(
      `${CUSTOMER_ID}/avatar.jpg`,
      BUCKETS.avatars.signedUrlTtlSeconds,
    );
    expect(createSignedUrl).toHaveBeenCalledWith(
      `passports/${BOOKING_ID}/photo.jpg`,
      BUCKETS.passportPhotos.signedUrlTtlSeconds,
    );
  });

  it("leaves the URLs null when there is nothing to sign", async () => {
    const context = visitContext();
    context.customer = null;
    context.identityGate.passport = null;
    vi.mocked(getVisitContext).mockResolvedValue(context);

    const result = await readTaskDetail(fakeCtx(), TASK_ID, "verification");
    const parsed = taskDetailResponseSchema.parse(result);
    if (parsed.kind !== "verification") throw new Error("expected a visit");
    expect(parsed.visit.customer).toBeNull();
    expect(parsed.visit.customerAvatarUrl).toBeNull();
    expect(parsed.visit.passportPhotoUrl).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("reads the cancellation only once the booking is terminal", async () => {
    vi.mocked(getVisitContext).mockResolvedValue(visitContext());
    vi.mocked(getBookingActionability).mockResolvedValue({
      ...actionability,
      standing: "terminal",
      blockedReason: "This booking was cancelled.",
    });
    vi.mocked(getCancellation).mockResolvedValue({
      at: NOW,
      by: "customer",
      reason: "Change of plans",
    });
    const ctx = fakeCtx();

    const result = await readTaskDetail(ctx, TASK_ID, "verification");

    expect(getCancellation).toHaveBeenCalledWith(ctx.core.db, BOOKING_ID);
    const parsed = taskDetailResponseSchema.parse(result);
    if (parsed.kind !== "verification") throw new Error("expected a visit");
    expect(parsed.visit.cancellation).toEqual({
      at: NOW.toISOString(),
      by: "customer",
      reason: "Change of plans",
    });
  });

  it("propagates NotFoundError from core untouched (the wrapper maps it to 404)", async () => {
    vi.mocked(getVisitContext).mockRejectedValue(
      new NotFoundError("Verification task", TASK_ID),
    );
    await expect(
      readTaskDetail(fakeCtx(), TASK_ID, "verification"),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(getBookingActionability).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* readTaskDetail — pickup                                              */
/* ------------------------------------------------------------------ */

describe("readTaskDetail (pickup)", () => {
  it("assembles a pickup detail that satisfies the contract", async () => {
    vi.mocked(getPickupContext).mockResolvedValue(pickupContext());
    const ctx = fakeCtx();

    const result = await readTaskDetail(ctx, TASK_ID, "pickup");

    expect(getPickupContext).toHaveBeenCalledWith(ctx.core.db, ctx.session, TASK_ID);
    expect(getVisitContext).not.toHaveBeenCalled();

    const parsed = taskDetailResponseSchema.parse(result);
    if (parsed.kind !== "pickup") throw new Error("expected a pickup");
    const { pickup } = parsed;
    expect(pickup.task.driverShiftId).toBe(SHIFT_ID);
    expect(pickup.scannedBagIds).toEqual([BAG_ID]);
    expect(pickup.shift).toEqual({ id: SHIFT_ID, truckName: "Van 2" });
    expect(pickup.bags[0]?.weightKg).toBe("12.50");
    expect(pickup.timeline[0]?.createdAt).toBe(NOW.toISOString());
    expect(pickup.customerAvatarUrl).toBe(
      `https://signed.test/${CUSTOMER_ID}/avatar.jpg`,
    );
    // Only the avatar is signed on a pickup; there is no passport here.
    expect(createSignedUrl).toHaveBeenCalledTimes(1);

    // The raw payload, before any parse: declared booking columns only.
    if (result.kind !== "pickup") throw new Error("expected a pickup");
    expect(Object.keys(result.pickup.booking).sort()).toEqual(
      Object.keys(bookingSchema.shape).sort(),
    );
    const wire = JSON.stringify(result);
    for (const needle of NEVER_ON_THE_WIRE) expect(wire).not.toContain(needle);
  });

  it("answers null travel when the address has no coordinates", async () => {
    const context = pickupContext();
    context.address = { ...address, lat: null, lng: null };
    vi.mocked(getPickupContext).mockResolvedValue(context);
    vi.mocked(staffTravelToDoor).mockResolvedValue(null);
    const ctx = fakeCtx();

    const result = await readTaskDetail(ctx, TASK_ID, "pickup");

    expect(staffTravelToDoor).toHaveBeenCalledWith(ctx.core, {
      staffUserId: USER_ID,
      destination: null,
    });
    const parsed = taskDetailResponseSchema.parse(result);
    if (parsed.kind !== "pickup") throw new Error("expected a pickup");
    expect(parsed.pickup.travel).toBeNull();
  });

  it("propagates NotFoundError from core untouched", async () => {
    vi.mocked(getPickupContext).mockRejectedValue(
      new NotFoundError("Pickup task", TASK_ID),
    );
    await expect(readTaskDetail(fakeCtx(), TASK_ID, "pickup")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

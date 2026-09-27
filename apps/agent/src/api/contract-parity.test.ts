import { describe, expect, it } from "vitest";
import {
  BUCKETS,
  bookingStatusEnum,
  PICKUP_EXCEPTION_REASONS as CORE_PICKUP_EXCEPTION_REASONS,
  VISIT_EXCEPTION_REASONS as CORE_VISIT_EXCEPTION_REASONS,
  passportValidityCheckStatusEnum,
  passportVerificationStatusEnum,
  paymentStatusEnum,
  taskStatusEnum,
  userRoleEnum,
  type BookingPhase,
  type BookingStanding,
  type CancellationRecord,
  type VisitGateBlocker,
} from "@koolee/core";
import {
  type BOOKING_PHASES,
  type BOOKING_STANDINGS,
  BOOKING_STATUSES,
  type CANCELLATION_ACTORS,
  PASSPORT_VALIDITY_CHECK_STATUSES,
  PASSPORT_VERIFICATION_STATUSES,
  PAYMENT_STATUSES,
  PICKUP_EXCEPTION_REASONS,
  TASK_STATUSES,
  UPLOAD_BUCKETS,
  USER_ROLES,
  VISIT_EXCEPTION_REASONS,
  type VISIT_GATE_BLOCKERS,
} from "@koolee/api-contract";

/**
 * The contract package copies enums out of @koolee/db and @koolee/core
 * because the native app cannot import either. This file is the only thing
 * that keeps those copies honest: it runs where both sides are importable
 * and fails the moment a value is added on one side and not the other.
 *
 * Order matters too — `toEqual` on the tuples, not a set comparison — so a
 * reordering in the migration shows up here rather than as a silent change
 * in what `z.enum` reports as its first option.
 */

/** `true` only when the two unions are exactly the same set of literals. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("contract parity — db enums", () => {
  it("BOOKING_STATUSES matches booking_status", () => {
    expect([...BOOKING_STATUSES]).toEqual(bookingStatusEnum.enumValues);
  });

  it("TASK_STATUSES matches task_status", () => {
    expect([...TASK_STATUSES]).toEqual(taskStatusEnum.enumValues);
  });

  it("PAYMENT_STATUSES matches payment_status", () => {
    expect([...PAYMENT_STATUSES]).toEqual(paymentStatusEnum.enumValues);
  });

  it("PASSPORT_VERIFICATION_STATUSES matches passport_verification_status", () => {
    expect([...PASSPORT_VERIFICATION_STATUSES]).toEqual(
      passportVerificationStatusEnum.enumValues,
    );
  });

  it("PASSPORT_VALIDITY_CHECK_STATUSES matches passport_validity_check_status", () => {
    expect([...PASSPORT_VALIDITY_CHECK_STATUSES]).toEqual(
      passportValidityCheckStatusEnum.enumValues,
    );
  });

  it("USER_ROLES matches user_role", () => {
    expect([...USER_ROLES]).toEqual(userRoleEnum.enumValues);
  });
});

describe("contract parity — core reason lists", () => {
  it("VISIT_EXCEPTION_REASONS matches services/agent-visit", () => {
    expect([...VISIT_EXCEPTION_REASONS]).toEqual([...CORE_VISIT_EXCEPTION_REASONS]);
  });

  it("PICKUP_EXCEPTION_REASONS matches services/pickup", () => {
    expect([...PICKUP_EXCEPTION_REASONS]).toEqual([...CORE_PICKUP_EXCEPTION_REASONS]);
  });
});

describe("contract parity — core union types", () => {
  // Core declares these as string-literal unions with no runtime array, so
  // the check is a compile-time one: `tsc --noEmit` fails if either side
  // gains or loses a member. The `expect` only keeps the constants used.
  it("BOOKING_STANDINGS is exactly BookingStanding", () => {
    const same: Same<BookingStanding, (typeof BOOKING_STANDINGS)[number]> = true;
    expect(same).toBe(true);
  });

  it("BOOKING_PHASES is exactly BookingPhase", () => {
    const same: Same<BookingPhase, (typeof BOOKING_PHASES)[number]> = true;
    expect(same).toBe(true);
  });

  it("VISIT_GATE_BLOCKERS is exactly VisitGateBlocker", () => {
    const same: Same<VisitGateBlocker, (typeof VISIT_GATE_BLOCKERS)[number]> = true;
    expect(same).toBe(true);
  });

  it("CANCELLATION_ACTORS is exactly CancellationRecord['by']", () => {
    // Travels on the wire in `taskDetailResponseSchema.cancellation.by`.
    const same: Same<CancellationRecord["by"], (typeof CANCELLATION_ACTORS)[number]> =
      true;
    expect(same).toBe(true);
  });
});

describe("contract parity — upload buckets", () => {
  it("names the same bucket ids as core BUCKETS", () => {
    expect(UPLOAD_BUCKETS.passportPhotos.bucket).toBe(BUCKETS.passportPhotos.id);
    expect(UPLOAD_BUCKETS.bagPhotos.bucket).toBe(BUCKETS.bagPhotos.id);
    expect(UPLOAD_BUCKETS.avatars.bucket).toBe(BUCKETS.avatars.id);
  });

  it("never lets the app accept a file the bucket would reject", () => {
    expect(UPLOAD_BUCKETS.passportPhotos.maxUploadBytes).toBeLessThanOrEqual(
      BUCKETS.passportPhotos.maxUploadBytes,
    );
    expect(UPLOAD_BUCKETS.bagPhotos.maxUploadBytes).toBeLessThanOrEqual(
      BUCKETS.bagPhotos.maxUploadBytes,
    );
    expect(UPLOAD_BUCKETS.avatars.maxUploadBytes).toBeLessThanOrEqual(
      BUCKETS.avatars.maxUploadBytes,
    );
  });
});

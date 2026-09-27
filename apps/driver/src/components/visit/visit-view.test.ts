import { describe, expect, it } from "vitest";
import { VISIT_EXCEPTION_REASONS } from "@koolee/api-contract";

import {
  allSealed,
  sealedCount,
  VISIT_EXCEPTION_OPTIONS,
  visitViewFrom,
  type VisitViewSource,
} from "./visit-view";

const TZ = "America/New_York";

function source(overrides: Partial<VisitViewSource> = {}): VisitViewSource {
  return {
    task: { id: "task-1", status: "in_progress" },
    booking: { id: "booking-1", paxName: "Ada Lovelace", status: "agent_assigned" },
    bags: [
      { id: "bag-1", ordinal: 1, sealId: "SEAL-1", weightKg: "23.50", photoUrls: ["a"] },
      { id: "bag-2", ordinal: 2, sealId: null, weightKg: null, photoUrls: [] },
    ],
    timeline: [{ eventType: "booking.created" }],
    identityGate: {
      agreement: {
        acceptedVersion: null,
        acceptance: null,
        currentVersion: {
          id: "v-3",
          version: 3,
          title: "Terms",
          effectiveFrom: "2026-01-01T00:00:00.000Z",
        },
        accepted: false,
      },
      passport: null,
      passportConfirmed: false,
      blockers: ["agreement_not_accepted", "passport_not_confirmed"],
      passed: false,
    },
    passportPhotoUrl: null,
    tz: TZ,
    ...overrides,
  };
}

describe("visitViewFrom", () => {
  it("reads arrival off the timeline, not the task", () => {
    expect(visitViewFrom(source()).arrived).toBe(false);
    expect(
      visitViewFrom(source({ timeline: [{ eventType: "visit.arrived" }] })).arrived,
    ).toBe(true);
  });

  it("falls back from the accepted version to the current one, then null", () => {
    expect(visitViewFrom(source()).agreement).toEqual({
      accepted: false,
      version: 3,
      acceptedAtLabel: null,
    });

    const accepted = visitViewFrom(
      source({
        identityGate: {
          ...source().identityGate,
          agreement: {
            acceptedVersion: {
              id: "v-2",
              version: 2,
              title: "Terms",
              effectiveFrom: "2025-01-01T00:00:00.000Z",
            },
            acceptance: {
              id: "acc-1",
              bookingId: "booking-1",
              agreementVersionId: "v-2",
              acceptedAt: "2026-06-10T22:20:00.000Z",
            },
            currentVersion: {
              id: "v-3",
              version: 3,
              title: "Terms",
              effectiveFrom: "2026-01-01T00:00:00.000Z",
            },
            accepted: true,
          },
        },
      }),
    ).agreement;
    // The version the customer ACCEPTED, not the newest one; the label in the
    // booking's zone (22:20 UTC is 6:20 PM in New York in June).
    expect(accepted).toEqual({
      accepted: true,
      version: 2,
      acceptedAtLabel: "Wed 10 Jun, 6:20 PM EDT",
    });

    const none = visitViewFrom(
      source({
        identityGate: {
          ...source().identityGate,
          agreement: {
            acceptedVersion: null,
            acceptance: null,
            currentVersion: null,
            accepted: false,
          },
        },
      }),
    );
    expect(none.agreement.version).toBeNull();
  });

  it("defaults the passport to pending when no row exists", () => {
    expect(visitViewFrom(source()).passport).toEqual({
      status: "pending",
      photoUrl: null,
    });
    const withPhoto = visitViewFrom(
      source({
        passportPhotoUrl: "https://signed/photo.jpg",
        identityGate: {
          ...source().identityGate,
          passport: {
            id: "p-1",
            bookingId: "booking-1",
            status: "customer_uploaded",
            photoStoragePath: "passports/booking-1/x.jpg",
            uploadedAt: "2026-06-01T00:00:00.000Z",
            confirmedAt: null,
            confirmedByAgentId: null,
            validityCheckStatus: "not_checked",
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
        },
      }),
    );
    expect(withPhoto.passport).toEqual({
      status: "customer_uploaded",
      photoUrl: "https://signed/photo.jpg",
    });
  });

  it("maps bags with their photo counts and keeps the ordinal from the row", () => {
    const view = visitViewFrom(source());
    expect(view.bags).toEqual([
      { id: "bag-1", ordinal: 1, sealId: "SEAL-1", weightKg: "23.50", photoCount: 1 },
      { id: "bag-2", ordinal: 2, sealId: null, weightKg: null, photoCount: 0 },
    ]);
    expect(sealedCount(view)).toBe(1);
    expect(allSealed(view)).toBe(false);
    expect(allSealed({ bags: [view.bags[0]!] })).toBe(true);
    expect(allSealed({ bags: [] })).toBe(true);
  });

  it("flags done and exception the way the web page does", () => {
    expect(visitViewFrom(source({ task: { id: "t", status: "done" } })).done).toBe(true);
    expect(visitViewFrom(source({ task: { id: "t", status: "failed" } })).exception).toBe(
      true,
    );
    expect(
      visitViewFrom(source({ booking: { id: "b", paxName: "Ada", status: "exception" } }))
        .exception,
    ).toBe(true);
    expect(visitViewFrom(source()).exception).toBe(false);
  });
});

describe("VISIT_EXCEPTION_OPTIONS", () => {
  it("covers every contract reason exactly once, in order", () => {
    expect(VISIT_EXCEPTION_OPTIONS.map((o) => o.value)).toEqual([
      ...VISIT_EXCEPTION_REASONS,
    ]);
  });
});

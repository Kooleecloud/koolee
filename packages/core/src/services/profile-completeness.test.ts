import { describe, expect, it } from "vitest";

import { profileCompleteness, type ProfileSubject } from "./profile-completeness";

/**
 * The definition of "finished", pinned.
 *
 * The rule that matters most is the NEGATIVE one: a per-booking obligation
 * must never leak in here. If accepting the agreement counted, every new
 * booking would un-complete a finished profile, and somebody with one
 * outstanding agreement would be told their PROFILE is incomplete — which is
 * not true and not fixable on the page the card links to.
 */

const complete: ProfileSubject = {
  phone: "+15551230000",
  phoneVerifiedAt: new Date("2026-08-01T00:00:00Z"),
  email: "casey@example.com",
  emailVerifiedAt: new Date("2026-08-01T00:00:00Z"),
  fullName: "Casey Rivera",
  avatarStoragePath: "u-1/abc.jpg",
};

describe("profileCompleteness", () => {
  it("is complete when all four are present and both channels are verified", () => {
    expect(profileCompleteness(complete)).toEqual({ complete: true, missing: [] });
  });

  it("lists everything for a brand-new account, in ask-order", () => {
    expect(
      profileCompleteness({
        phone: null,
        phoneVerifiedAt: null,
        email: null,
        emailVerifiedAt: null,
        fullName: null,
        avatarStoragePath: null,
      }),
    ).toEqual({
      complete: false,
      missing: ["verify_phone", "verify_email", "add_name", "add_photo"],
    });
  });

  it("treats an unverified channel exactly like a missing one", () => {
    // A number on file that was never verified is worth nothing when a driver
    // is at the kerb, so both cases produce the same item.
    const unverified = profileCompleteness({
      ...complete,
      phoneVerifiedAt: null,
      emailVerifiedAt: null,
    });
    expect(unverified.missing).toEqual(["verify_phone", "verify_email"]);
  });

  it("does not accept a whitespace name", () => {
    expect(profileCompleteness({ ...complete, fullName: "   " }).missing).toEqual([
      "add_name",
    ]);
  });

  it("asks for the photo when there is no avatar path", () => {
    expect(profileCompleteness({ ...complete, avatarStoragePath: null }).missing).toEqual(
      ["add_photo"],
    );
  });

  it("treats a missing user as an empty profile rather than throwing", () => {
    // The page renders before `getCustomerById` has ever succeeded on a fresh
    // account; a throw here would be a blank trips home.
    expect(profileCompleteness(null).complete).toBe(false);
    expect(profileCompleteness(null).missing).toHaveLength(4);
  });

  it("names nothing that belongs to a booking", () => {
    // The guard on the rule this module exists to hold.
    const everyGap = profileCompleteness(null).missing.join(",");
    for (const perBooking of ["agreement", "passport", "driver", "booking"]) {
      expect(everyGap).not.toContain(perBooking);
    }
  });
});

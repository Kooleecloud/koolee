import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A refusal at the flight step must cost a correction, not the form.
 *
 * THE BUG. `submitFlight` returned every rejection BEFORE `writeDraft`, so
 * nothing the customer had typed was persisted. `usePreservedFormValues`
 * covers the action round trip inside one mount — but an out-of-area ZIP does
 * not stay mounted: `CoverageStepForm` swaps the whole form for the waitlist
 * card, whose "Try another ZIP" is a real link back to `/book/flight`. There,
 * `flightEntryMode` found an empty draft and rendered the UPLOAD DOOR.
 *
 * A customer who had typed a flight number, an airport, a date, a time and
 * their name got a file-drop area and no explanation, having done nothing
 * wrong except live one street outside coverage.
 *
 * THE OTHER HALF of the fix is the quarantine boundary. Rejected values go
 * under `flightEntry` and nowhere else: a refused ZIP written into
 * `draft.zip` would make `stepCompletion` read step one as complete and send
 * the customer forward through a funnel they never cleared.
 */

const h = vi.hoisted(() => ({
  readDraft: vi.fn(),
  writeDraft: vi.fn(),
  redirect: vi.fn(),
  checkCoverage: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    h.redirect(path);
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
  },
}));

vi.mock("@koolee/core", () => ({
  checkCoverage: h.checkCoverage,
  // A real Date, not a bare `vi.fn()`: the name check sits AFTER the
  // departure-time parse, so a mock returning `undefined` throws before the
  // rejection under test is ever reached.
  airportLocalDateTime: () => new Date("2099-09-03T22:00:00.000Z"),
  ConflictError: class ConflictError extends Error {},
  createBooking: vi.fn(),
  discardBookingDraft: vi.fn(),
  FALLBACK_DISPLAY_TZ: "America/New_York",
  listBookableWindows: vi.fn(),
  OutOfCoverageError: class OutOfCoverageError extends Error {},
  QuoteZipMismatchError: class QuoteZipMismatchError extends Error {},
  recordWaitlistSignup: vi.fn(),
  resolveDisplayTz: vi.fn(),
  SlotNotSellableError: class SlotNotSellableError extends Error {},
  softDeleteBookingDraft: vi.fn(),
}));

vi.mock("@/lib/booking-draft", () => ({
  clearDraft: vi.fn(),
  readDraft: h.readDraft,
  writeDraft: h.writeDraft,
}));
vi.mock("@/lib/draft-sync", () => ({ syncDraftRow: vi.fn() }));
vi.mock("@/actions/auth", () => ({ ensureDraftSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/booking-events", () => ({ emitBookingConfirmed: vi.fn() }));
vi.mock("@/lib/checkout", () => ({
  buildCheckoutSetup: vi.fn(),
  isDraftReadyForPayment: vi.fn(),
}));
vi.mock("@/lib/core", () => ({ getCore: vi.fn(), tryGetCore: () => null }));

const { submitFlight } = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

/** Everything a customer would have typed before we said no. */
const TYPED = {
  zip: "90210",
  flightNumber: "DL123",
  departureAirport: "JFK",
  destinationAirport: "LHR",
  departureAt: "2099-09-03T18:00",
  scope: "international",
  paxName: "Casey Rivera",
};

/** The one write a rejection makes, as a plain object. */
function patch(): Record<string, unknown> {
  return h.writeDraft.mock.calls[0]![0] as Record<string, unknown>;
}

/** Keys `stepCompletion` reads. None may ever appear in a rejection's write. */
const BOOKING_KEYS = [
  "zip",
  "quotedZip",
  "flightNumber",
  "airlineIata",
  "departureAirport",
  "departureAt",
  "scope",
  "paxName",
];

describe("submitFlight — a refusal keeps what was typed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.readDraft.mockResolvedValue({});
    h.writeDraft.mockImplementation((p: object) => Promise.resolve(p));
  });

  it("preserves every field when the ZIP is out of area", async () => {
    h.checkCoverage.mockReturnValue({
      covered: false,
      reason: "out_of_area",
      zip: "90210",
    });

    const state = await submitFlight({}, form(TYPED));

    expect(state.outOfCoverageZip).toBe("90210");
    expect(h.writeDraft).toHaveBeenCalledTimes(1);
    expect(patch().flightEntry).toEqual(TYPED);
  });

  it("writes ONLY the quarantined key — never a field that counts as progress", async () => {
    h.checkCoverage.mockReturnValue({
      covered: false,
      reason: "out_of_area",
      zip: "90210",
    });

    await submitFlight({}, form(TYPED));

    expect(Object.keys(patch())).toEqual(["flightEntry"]);
    for (const key of BOOKING_KEYS) expect(key in patch()).toBe(false);
  });

  it("preserves a malformed ZIP too, so one digit can be corrected", async () => {
    h.checkCoverage.mockReturnValue({ covered: false, reason: "malformed", zip: null });

    const state = await submitFlight({}, form({ ...TYPED, zip: "1000" }));

    expect(state.error).toMatch(/does not look right/i);
    expect(patch().flightEntry).toMatchObject({ zip: "1000" });
  });

  /**
   * Not only the coverage check. Every refusal at this step reaches the same
   * form, so every one of them has to preserve it — a customer who mistypes a
   * flight number must not lose their name and their date to fix it.
   */
  describe("every other rejection at this step", () => {
    beforeEach(() => {
      h.checkCoverage.mockReturnValue({ covered: true, zip: "10001" });
    });

    it("a bad flight number", async () => {
      const state = await submitFlight({}, form({ ...TYPED, flightNumber: "nope" }));
      expect(state.error).toMatch(/flight number/i);
      expect(patch().flightEntry).toMatchObject({ paxName: "Casey Rivera" });
    });

    it("an airport we do not serve", async () => {
      const state = await submitFlight({}, form({ ...TYPED, departureAirport: "LAX" }));
      expect(state.error).toMatch(/JFK, LGA, or EWR/);
      expect(patch().flightEntry).toMatchObject({ flightNumber: "DL123" });
    });

    it("a missing departure time", async () => {
      const state = await submitFlight({}, form({ ...TYPED, departureAt: "" }));
      expect(state.error).toMatch(/departure date and time/i);
      expect(patch().flightEntry).toMatchObject({ paxName: "Casey Rivera" });
    });

    it("a missing passenger name", async () => {
      const state = await submitFlight({}, form({ ...TYPED, paxName: "" }));
      expect(state.error).toMatch(/name on the ticket/i);
      expect(patch().flightEntry).toMatchObject({ flightNumber: "DL123" });
    });
  });
});

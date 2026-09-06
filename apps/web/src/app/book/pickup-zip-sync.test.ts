import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The pickup step's ZIP reconciliation.
 *
 * The funnel asks for a ZIP on the flight step — that is what answers "do you
 * come to me?" and what the quote is built from — and for a full address two
 * steps later. Nothing used to make the two agree: any covered ZIP was
 * accepted at the address step and silently replaced the quoted one. Both
 * ZIPs pass coverage, which is exactly why nothing complained; they are still
 * two different places, with their own `zip_centroids` coordinate (where
 * every drive-time estimate starts) and their own `agent_zones` row.
 *
 * `createBooking` refuses the mismatch outright — see
 * `create-booking.integration.test.ts`. These tests cover the step in front of
 * it: the customer is told, and chooses.
 */

const h = vi.hoisted(() => ({
  readDraft: vi.fn(),
  writeDraft: vi.fn(),
  redirect: vi.fn(),
  syncDraftRow: vi.fn(),
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
  airportLocalDateTime: vi.fn(),
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
vi.mock("@/lib/draft-sync", () => ({ syncDraftRow: h.syncDraftRow }));
vi.mock("@/actions/auth", () => ({ ensureDraftSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/booking-events", () => ({ emitBookingConfirmed: vi.fn() }));
vi.mock("@/lib/checkout", () => ({
  buildCheckoutSetup: vi.fn(),
  isDraftReadyForPayment: vi.fn(),
}));
vi.mock("@/lib/core", () => ({ getCore: vi.fn(), tryGetCore: () => null }));

const { submitPickup } = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const ADDRESS = {
  line1: "200 Joralemon St",
  city: "Brooklyn",
  state: "NY",
  zip: "11201",
  bagCount: "2",
};

describe("submitPickup — ZIP reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.writeDraft.mockImplementation((patch: object) => Promise.resolve(patch));
    // Both ZIPs in play are inside the service area.
    h.checkCoverage.mockImplementation((zip: string) => ({
      covered: true,
      zip: zip.trim().slice(0, 5),
    }));
  });

  it("stops and explains when the address ZIP is not the quoted one", async () => {
    h.readDraft.mockResolvedValue({ quotedZip: "10001", zip: "10001" });

    const state = await submitPickup({}, form(ADDRESS));

    expect(state.zipMismatch).toEqual({ quotedZip: "10001", addressZip: "11201" });
    expect(state.error).toBeUndefined();
    /*
     * NO BOOKING FIELD IS WRITTEN until the customer chooses — which is what
     * this test has always been about, and still is.
     *
     * What changed is that "nothing is written" is no longer the way to say
     * it. The address is now preserved under the quarantined `pickupEntry`
     * key so a reload mid-decision does not cost the customer their address
     * (see `rejectedEntrySchema`), and asserting the QUARANTINE BOUNDARY is a
     * stronger claim than asserting silence: it proves the refused values
     * cannot reach `zip`, `quotedZip`, `bagCount` or the precision fields,
     * where `stepCompletion` would count them as progress.
     */
    expect(h.writeDraft).toHaveBeenCalledTimes(1);
    expect(Object.keys(h.writeDraft.mock.calls[0]![0] as object)).toEqual([
      "pickupEntry",
    ]);
  });

  it("re-quotes for the new ZIP once the customer confirms", async () => {
    h.readDraft.mockResolvedValue({
      quotedZip: "10001",
      zip: "10001",
      windowStart: "2026-09-01T12:00:00.000Z",
      windowEnd: "2026-09-01T13:00:00.000Z",
    });

    await expect(
      submitPickup({}, form({ ...ADDRESS, confirmZipChange: "1" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    const patch = h.writeDraft.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch.zip).toBe("11201");
    expect(patch.quotedZip).toBe("11201");
    // The chosen window was priced against the old location's lead time and
    // drive-time headroom. It goes with the quote.
    expect(patch.windowStart).toBeUndefined();
    expect(patch.windowEnd).toBeUndefined();
    expect(h.redirect).toHaveBeenCalled();
  });

  it("passes straight through when the address is in the quoted ZIP", async () => {
    h.readDraft.mockResolvedValue({ quotedZip: "11201", zip: "11201" });

    await expect(submitPickup({}, form(ADDRESS))).rejects.toThrow("NEXT_REDIRECT");

    const patch = h.writeDraft.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch.quotedZip).toBe("11201");
    expect("windowStart" in patch).toBe(false);
  });

  it("treats a ZIP+4 address as the ZIP it was quoted for", async () => {
    h.readDraft.mockResolvedValue({ quotedZip: "11201", zip: "11201" });

    await expect(
      submitPickup({}, form({ ...ADDRESS, zip: "11201-2345" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(h.writeDraft).toHaveBeenCalled();
  });

  it("blocks an out-of-coverage ZIP before it ever reaches reconciliation", async () => {
    h.readDraft.mockResolvedValue({ quotedZip: "10001", zip: "10001" });
    h.checkCoverage.mockReturnValue({
      covered: false,
      reason: "out_of_area",
      zip: "90210",
    });

    const state = await submitPickup({}, form({ ...ADDRESS, zip: "90210" }));

    expect(state.outOfCoverageZip).toBe("90210");
    expect(state.error).toBe("We do not serve that ZIP code yet.");
    expect(state.zipMismatch).toBeUndefined();
    // Same boundary as above: the refused address is preserved for the
    // customer to correct, and cannot leak into a booking field.
    expect(h.writeDraft).toHaveBeenCalledTimes(1);
    const patch = h.writeDraft.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(["pickupEntry"]);
    expect(patch.pickupEntry).toMatchObject({
      line1: "200 Joralemon St",
      city: "Brooklyn",
      state: "NY",
      zip: "90210",
      bagCount: "2",
    });
  });

  /**
   * The refusal must cost a correction, not the address.
   *
   * Out-of-area swaps the whole form for the waitlist card, and its "Try
   * another ZIP" is a real link back to `/book/pickup` — which re-reads the
   * draft. Before this, the draft only ever held an address that had already
   * been ACCEPTED, so a first-time customer got an empty form and no
   * explanation of where their typing had gone.
   */
  it("preserves a refused address without ever letting it reach a booking field", async () => {
    h.readDraft.mockResolvedValue({ quotedZip: "10001", zip: "10001" });
    h.checkCoverage.mockReturnValue({
      covered: false,
      reason: "out_of_area",
      zip: "90210",
    });

    await submitPickup({}, form({ ...ADDRESS, line2: "Apt 4B", zip: "90210" }));

    const patch = h.writeDraft.mock.calls[0]![0] as Record<string, unknown>;
    // Everything they typed, including the unit.
    expect(patch.pickupEntry).toMatchObject({ line2: "Apt 4B" });
    // …and NONE of the keys `stepCompletion` reads as progress.
    for (const key of ["zip", "quotedZip", "line1", "city", "state", "bagCount"]) {
      expect(key in patch).toBe(false);
    }
  });

  it("adopts the address ZIP when the draft never carried a quote", async () => {
    // A draft cookie minted before `quotedZip` existed, or one resumed from
    // the server mirror. There is nothing to reconcile against, so the
    // address ZIP becomes the quote rather than blocking the customer.
    h.readDraft.mockResolvedValue({});

    await expect(submitPickup({}, form(ADDRESS))).rejects.toThrow("NEXT_REDIRECT");

    const patch = h.writeDraft.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch.quotedZip).toBe("11201");
  });
});

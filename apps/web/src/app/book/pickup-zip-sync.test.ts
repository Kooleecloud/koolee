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
    // Nothing is written until the customer chooses.
    expect(h.writeDraft).not.toHaveBeenCalled();
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
    expect(h.writeDraft).not.toHaveBeenCalled();
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

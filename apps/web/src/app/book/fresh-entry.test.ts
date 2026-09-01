import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The funnel's front door starts a NEW booking (D2).
 *
 * THE COMPLAINT. `/book` resumed unconditionally, so pressing "Book a pickup"
 * dropped you back into a half-finished booking from days ago — at whatever
 * step it had reached, with its flight and address prefilled. Someone booking
 * a second trip got an old one and had to notice, then edit every field.
 *
 * THE TWO HALVES, and they pull against each other. A fresh entry must start
 * CLEAN, and nothing may be silently destroyed to achieve it — so the old
 * draft is MOVED to `koolee_draft_prev` rather than deleted, the live cookie
 * really does go, and the first step offers it back in one tap.
 *
 * WHAT MUST NOT CHANGE is everything F4 built: back and forward between steps,
 * a rejected ZIP, a mid-funnel reload. None of those come through this door —
 * they address `/book/flight` and friends directly — which is why the door can
 * be this decisive. `flight-rejection.test.ts` guards that half; this one
 * guards the door and asserts, below, that it is the ONLY thing being cleared.
 */

const h = vi.hoisted(() => ({
  readDraft: vi.fn(),
  getAuthUser: vi.fn(),
  getBookingDraft: vi.fn(),
  tryGetCore: vi.fn(),
}));

vi.mock("@/lib/booking-draft", async () => {
  const actual = await vi.importActual<typeof import("@/lib/booking-draft-schema")>(
    "@/lib/booking-draft-schema",
  );
  return {
    DRAFT_COOKIE_NAME: "koolee_draft",
    STASH_COOKIE_NAME: "koolee_draft_prev",
    stashCookieOptions: () => ({ httpOnly: true, path: "/", maxAge: 3600 }),
    readDraft: h.readDraft,
    bookingDraftSchema: actual.bookingDraftSchema,
  };
});

vi.mock("@/lib/auth", () => ({ getAuthUser: h.getAuthUser }));
vi.mock("@/lib/core", () => ({ tryGetCore: h.tryGetCore }));
vi.mock("@koolee/core", () => ({ getBookingDraft: h.getBookingDraft }));

const { GET } = await import("./route");

/** A draft with real progress on it — the kind worth offering back. */
const WITH_PROGRESS = {
  zip: "10018",
  flightNumber: "DL123",
  departureAirport: "JFK",
} as const;

/**
 * A cookie holding nothing but a session id, minted by a ticket upload that
 * went nowhere. Nobody remembers starting this, and offering to resume it
 * would be offering to resume a blank form.
 */
const NO_PROGRESS = { draftId: "d-1" } as const;

function request() {
  return new Request("http://localhost:3000/book");
}

/** What the response actually tells the browser to do with each cookie. */
function cookieAction(response: Response, name: string) {
  const headers = response.headers.getSetCookie?.() ?? [];
  const line = headers.find((h) => h.startsWith(`${name}=`));
  if (!line) return "untouched";
  // A deletion is an empty value, an expiry in the past, or Max-Age=0.
  return /^[^=]+=;/.test(line) || /Max-Age=0/i.test(line) ? "deleted" : "set";
}

function stashedValue(response: Response) {
  const line = (response.headers.getSetCookie?.() ?? []).find((h) =>
    h.startsWith("koolee_draft_prev="),
  );
  if (!line) return null;
  const raw = decodeURIComponent(line.slice("koolee_draft_prev=".length).split(";")[0]!);
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.readDraft.mockResolvedValue({});
  h.getAuthUser.mockResolvedValue(null);
  h.tryGetCore.mockReturnValue(null);
});

describe("/book — the funnel's front door", () => {
  it("always lands on the FIRST step, never mid-funnel", async () => {
    h.readDraft.mockResolvedValue(WITH_PROGRESS);
    const response = await GET(request());
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/book/flight");
  });

  /*
   * THE RESET. The live cookie goes, so the first step renders an empty form
   * rather than one wearing last week's flight.
   */
  it("clears the live draft so the entry is genuinely clean", async () => {
    h.readDraft.mockResolvedValue(WITH_PROGRESS);
    const response = await GET(request());
    expect(cookieAction(response, "koolee_draft")).toBe("deleted");
  });

  /* NOT DESTROYED — moved, so the first step can offer it back. */
  it("sets the old draft aside instead of throwing it away", async () => {
    h.readDraft.mockResolvedValue(WITH_PROGRESS);
    const response = await GET(request());
    expect(cookieAction(response, "koolee_draft_prev")).toBe("set");
    expect(stashedValue(response)).toMatchObject(WITH_PROGRESS);
  });

  /*
   * EXTRACTED TICKET DATA GOES WITH IT. `ticketPrefill` is a key on the draft
   * cookie, so deleting the cookie takes the model's reading of somebody's
   * itinerary with it — and stashing carries it back on a resume, which is
   * what makes "resume" mean resume rather than "start again from the ZIP".
   */
  it("carries the extracted ticket data out of the live draft and into the stash", async () => {
    const withTicket = {
      ...WITH_PROGRESS,
      ticketPrefill: { flightNumber: "DL123", departureAirport: "JFK" },
    };
    h.readDraft.mockResolvedValue(withTicket);
    const response = await GET(request());

    expect(cookieAction(response, "koolee_draft")).toBe("deleted");
    expect(stashedValue(response)).toMatchObject({
      ticketPrefill: { flightNumber: "DL123" },
    });
  });

  /* --- nothing worth offering ----------------------------------------- */

  it("offers nothing when the draft has no progress on it", async () => {
    h.readDraft.mockResolvedValue(NO_PROGRESS);
    const response = await GET(request());
    expect(cookieAction(response, "koolee_draft_prev")).toBe("deleted");
  });

  /*
   * A stash from an earlier visit must not outlive the draft it came from.
   * Without the delete, somebody who finished a booking and came back would be
   * offered a draft they had already completed.
   */
  it("drops a leftover stash when there is nothing to replace it with", async () => {
    h.readDraft.mockResolvedValue({});
    const response = await GET(request());
    expect(cookieAction(response, "koolee_draft_prev")).toBe("deleted");
    expect(cookieAction(response, "koolee_draft")).toBe("deleted");
  });

  /* --- the account holder's mirror ------------------------------------ */

  /*
   * An empty cookie plus a `booking_drafts` row means a draft started on
   * another device. Worth OFFERING — that is the whole point of the mirror —
   * but no longer worth redirecting into unasked.
   */
  it("offers a draft from another device rather than resuming into it", async () => {
    h.getAuthUser.mockResolvedValue({ id: "u-1" });
    h.tryGetCore.mockReturnValue({ db: {} });
    h.getBookingDraft.mockResolvedValue({ payload: WITH_PROGRESS });

    const response = await GET(request());

    expect(new URL(response.headers.get("location")!).pathname).toBe("/book/flight");
    expect(stashedValue(response)).toMatchObject(WITH_PROGRESS);
  });

  it("does not consult the mirror when the cookie already has progress", async () => {
    h.readDraft.mockResolvedValue(WITH_PROGRESS);
    h.getAuthUser.mockResolvedValue({ id: "u-1" });
    h.tryGetCore.mockReturnValue({ db: {} });

    await GET(request());

    expect(h.getBookingDraft).not.toHaveBeenCalled();
  });

  /*
   * A rehydration that fails costs the customer an OFFER, never the booking
   * they came here to make. The door still opens, clean.
   */
  it("still opens the funnel when the mirror lookup throws", async () => {
    h.getAuthUser.mockResolvedValue({ id: "u-1" });
    h.tryGetCore.mockReturnValue({ db: {} });
    h.getBookingDraft.mockRejectedValue(new Error("db down"));

    const response = await GET(request());

    expect(new URL(response.headers.get("location")!).pathname).toBe("/book/flight");
    expect(cookieAction(response, "koolee_draft_prev")).toBe("deleted");
  });

  it("ignores a mirror row whose payload does not parse", async () => {
    h.getAuthUser.mockResolvedValue({ id: "u-1" });
    h.tryGetCore.mockReturnValue({ db: {} });
    h.getBookingDraft.mockResolvedValue({ payload: { zip: 12345 } });

    const response = await GET(request());
    expect(cookieAction(response, "koolee_draft_prev")).toBe("deleted");
  });
});

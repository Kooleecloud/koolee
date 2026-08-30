import { describe, expect, it } from "vitest";

import { HeuristicTicketExtractor } from "./heuristic";
import { makePdf } from "./test-utils/make-pdf";
import { normalizeSegment, selectSegment } from "./select-segment";
import { cleanPaxName, takeNameWords } from "./read-result";

/**
 * The regression suite for the three failures TD reported off staging:
 * multi-leg itineraries coming back as one leg, the wrong traveler name, and
 * wrong flight times (RUN-REPORT-8, Phase 0).
 *
 * Every fixture is BUILT IN CODE. Committing the real PDFs would put a
 * customer's itinerary in the repository and a megabyte in every clone; the
 * layouts below are transcriptions of the ones that actually failed, reduced
 * to the rows that carry the failure. Each `it` names the document property
 * it pins, so a later prompt or parser change that reintroduces one of these
 * fails on the specific thing it broke rather than on a blob comparison.
 *
 * These run the HEURISTIC adapter — the one an environment without an
 * `ANTHROPIC_API_KEY` gets, and the one every symptom was traced to. The
 * model adapter's own reading is covered by `claude.test.ts` (mocked) and
 * `claude.live.test.ts` (a real call, opt-in).
 */

// Every fixture below departs after this instant, so "has this leg flown?"
// is decided by the fixture and never by the day the suite happens to run.
const NOW = new Date("2026-06-01T12:00:00Z");
const extractor = new HeuristicTicketExtractor({ now: () => NOW });

function read(lines: string[]) {
  return extractor.extract({ data: makePdf(lines), mimeType: "application/pdf" });
}

/* ------------------------------------------------------------------ */
/* Symptom 1 — multi-leg itineraries came back as one leg              */
/* ------------------------------------------------------------------ */

describe("every leg on the document is reported", () => {
  it("reads both legs of a round trip and offers the other one", async () => {
    const outcome = await read([
      "SKYWAY TRAVEL - ELECTRONIC TICKET RECEIPT",
      "Passenger: ALVAREZ/JORDAN MR",
      "OUTBOUND",
      "  JFK - LAX   DL 411   Depart Sep 14, 2026 07:45   Arrive 11:10",
      "RETURN",
      "  LAX - JFK   DL 412   Depart Sep 21, 2026 13:20   Arrive 21:50",
    ]);

    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.legs).toHaveLength(2);
    expect(outcome.result.legs?.map((l) => l.originAirport)).toEqual(["JFK", "LAX"]);
    expect(outcome.result.chosenLegIndex).toBe(0);
    expect(outcome.result.documentKind).toBe("round_trip");
    // Only one leg leaves New York, so there is nothing to swap TO.
    expect(outcome.result.alternativeSegments ?? []).toHaveLength(0);
    expect(outcome.diagnostics?.segments).toHaveLength(2);
  });

  it("reads all three legs of a multi-city itinerary", async () => {
    const outcome = await read([
      "MULTI-CITY ITINERARY - GLOBALFARE",
      "PASSENGER NAME: OKONKWO/ADAEZE",
      "1. JFK - LHR   BA 178   14 Nov 2026   19:30",
      "2. LHR - CDG   AF 1281  20 Nov 2026   08:05",
      "3. CDG - EWR   AF 6     26 Nov 2026   13:15",
    ]);

    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    // The whole itinerary is reported even though two legs leave airports
    // Koolee does not serve — the review form lists them and says why.
    expect(outcome.result.legs?.map((l) => l.originAirport)).toEqual([
      "JFK",
      "LHR",
      "CDG",
    ]);
    expect(outcome.result.departureAirport).toBe("JFK");
    expect(outcome.result.documentKind).toBe("multi_city");
  });

  it("offers the second New York departure as a swap on an open jaw", async () => {
    const outcome = await read([
      "OPEN JAW ITINERARY",
      "Passenger: CHEN/WEI MS",
      "Outbound  JFK - MIA  AA 1420  Departs Dec 02, 2026 08:00",
      "Return    MIA - EWR  AA 1755  Departs Dec 09, 2026 17:30",
      "Onward    EWR - YYZ  AC 705   Departs Dec 15, 2026 06:45",
    ]);

    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.legs).toHaveLength(3);
    expect(outcome.result.selectionReason).toBe("ambiguous_serviced_origins");
    expect(outcome.result.alternativeSegments?.map((s) => s.originAirport)).toEqual([
      "EWR",
    ]);
  });

  it("does not invent a leg out of an ordinary English word", () => {
    // "CUSTOMER" parses as CUS → MER when the TO form is allowed to match
    // with no whitespace. That produced a phantom third leg on the Yatra
    // fixture, which then competed for selection.
    const selection = selectSegment(
      [normalizeSegment({ originAirport: "CUS", destinationAirport: "MER" }, 0).segment],
      { today: "2026-06-01" },
    );
    expect(selection.reason).toBe("no_serviced_origin");
  });
});

/* ------------------------------------------------------------------ */
/* Symptom 2 — the traveler name was wrong                             */
/* ------------------------------------------------------------------ */

describe("the traveler name", () => {
  it("prefers the passenger over the purchaser and the loyalty member", async () => {
    const outcome = await read([
      "E-TICKET CONFIRMATION",
      "Billed to: Daniel Okoye (cardholder)",
      "Frequent flyer member: SKYPLUS GOLD - Helena Okoye",
      "Passenger name: NAKAMURA/YUKI MS",
      "JFK - NRT   NH 9   Departs Sep 30, 2026 11:05",
    ]);

    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.paxName).toBe("Yuki Nakamura");
  });

  it("stops at the next label printed on the same row", () => {
    expect(cleanPaxName(takeNameWords("DANA WHITFIELD Booking Ref: QX7T2M"))).toBe(
      "Dana Whitfield",
    );
    expect(cleanPaxName(takeNameWords("Alex Traveler · UA 1189 SFO-JFK"))).toBe(
      "Alex Traveler",
    );
  });

  it("refuses a heading that happens to follow the word passenger", () => {
    // Both observed: the Yatra ticket's section header, and its cancellation
    // terms ("...per passenger basis. In case of amendment...").
    expect(cleanPaxName(takeNameWords("DETAILS FLIGHT E-TICKET YATRA"))).toBeUndefined();
    expect(
      cleanPaxName(takeNameWords("becomes a no show, only the applicable taxes")),
    ).toBeUndefined();
  });

  it("drops the title instead of reordering the name around it", () => {
    expect(cleanPaxName("ALVAREZ/JORDAN MR")).toBe("Jordan Alvarez");
    expect(cleanPaxName(takeNameWords("Mr Karun Rathi (Adult)"))).toBe("Karun Rathi");
  });
});

/* ------------------------------------------------------------------ */
/* Symptom 3 — the flight times were wrong                             */
/* ------------------------------------------------------------------ */

describe("the departure time", () => {
  it("never reads a printed duration as a clock time", async () => {
    // The Yatra layout: a route header carrying the flight DURATION, with
    // the real departure printed underneath. "15:30 Hrs" is 15 hours 30
    // minutes of flying, and it used to become a 3:30 PM departure.
    const outcome = await read([
      "AIRLINE DEPARTURE ARRIVAL DURATION PNR",
      "Newark New Delhi 19:25 Hrs J6Z32",
      "EWR - DEL   Air India   AI 144   Depart Dec 15, 2026 13:15",
    ]);

    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.departureAtLocal).toBe("2026-12-15T13:15");
  });

  it("never pairs a date of issue with a departure time from another row", async () => {
    const outcome = await read([
      "UNITED AIRLINES ELECTRONIC TICKET RECEIPT",
      "Date of issue: 25 JUL 2026",
      "Passenger: TRAVELER/ALEX MR",
      "JFK - SFO   Flight UA 1189   Departs 03 AUG 2026 08:15",
    ]);

    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    // The bug wrote 2026-07-25T08:15: the issue date with the departure time.
    expect(outcome.result.departureAtLocal).toBe("2026-08-03T08:15");
  });

  it("takes the departure time, not the arrival time on the same row", async () => {
    const outcome = await read([
      "ITINERARY",
      "Passenger: CHEN/WEI",
      "JFK - LAX  DL 411  Depart Sep 14, 2026 07:45  Arrive Sep 14, 2026 11:10",
    ]);

    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.departureAtLocal).toBe("2026-09-14T07:45");
  });

  it("pairs a date row with a labelled departure time on the next row", async () => {
    const outcome = await read([
      "UNITED AIRLINES E-TICKET",
      "Passenger: ALVAREZ/JORDAN",
      "Flight: UA 1189",
      "From: New York, NY (JFK) Terminal 7",
      "To: San Francisco, CA (SFO) Terminal 3",
      "Date: Aug 4, 2026",
      "Departs: 5:45 PM Arrives: 9:12 PM",
    ]);

    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.departureAtLocal).toBe("2026-08-04T17:45");
    expect(outcome.result.flightNumber).toBe("UA1189");
  });

  it("leaves the time blank rather than guessing midday", async () => {
    // The old parser wrote `pad(hh ?? 12)` and still called it high
    // confidence. A blank the customer fills in is the honest answer.
    const outcome = await read([
      "ITINERARY",
      "Passenger: DOE/SAM",
      "JFK - MIA   AA 100   Travelling on Jun 12, 2026",
    ]);

    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.departureAtLocal).toBeUndefined();
    expect(outcome.diagnostics?.readingNotes).toContain("no departure date and time");
  });
});

/* ------------------------------------------------------------------ */
/* Cross-cutting: the flight number, and honesty                       */
/* ------------------------------------------------------------------ */

describe("the flight number", () => {
  it("is reassembled when the designator arrives in the field next door", () => {
    // The model routinely splits "AI 191" into { airlineIata: "AI",
    // flightNumber: "191" }. Four of the twelve Phase 0 fixtures lost their
    // flight number to this, which is the field the cutoff table is keyed by.
    const { segment, dropped } = normalizeSegment(
      { originAirport: "JFK", airlineIata: "AI", flightNumber: "191" },
      0,
    );
    expect(segment.flightNumber).toBe("AI191");
    expect(segment.airlineIata).toBe("AI");
    expect(dropped).toHaveLength(0);
  });

  it("still drops digits with no airline code to attach them to", () => {
    const { segment, dropped } = normalizeSegment({ flightNumber: "191" }, 0);
    expect(segment.flightNumber).toBeUndefined();
    expect(dropped[0]?.reason).toBe("not an IATA flight number");
  });

  it("is not a baggage allowance printed in the same shape", async () => {
    // "NA 2 piece (Free)" is shaped exactly like "AI 144", and became a
    // flight called NA2 on the Yatra fixture.
    const outcome = await read([
      "PASSENGERS DETAILS",
      "Mr Karun Rathi (Adult)",
      "EWR - DEL NA 2 piece (Free) NA   Depart Dec 15, 2026 13:15",
    ]);

    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.flightNumber).toBeUndefined();
  });
});

describe("honesty", () => {
  it("is never high confidence, however clean the document looks", async () => {
    const outcome = await read([
      "UNITED AIRLINES - ETICKET ITINERARY AND RECEIPT",
      "PASSENGER NAME: ALVAREZ/JORDAN",
      "FLIGHT UA 1189",
      "JFK TO SFO",
      "DEPARTS SEP 1, 2026 6:30 PM",
    ]);

    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.confidence).toBe("low");
  });

  it("reports a photographed ticket as unreadable, and says why", async () => {
    const outcome = await extractor.extract({
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mimeType: "image/png",
    });
    expect(outcome.status).toBe("unreadable");
    if (outcome.status !== "unreadable") return;
    expect(outcome.reason).toContain("image/png");
  });
});

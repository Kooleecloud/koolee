import { describe, expect, it, vi } from "vitest";

import {
  CLAUDE_ESCALATION_MODEL,
  CLAUDE_EXTRACTION_MODEL,
  ClaudeTicketExtractor,
} from "./claude";
import { makePdf } from "./test-utils/make-pdf";

/**
 * Claude adapter with MOCKED API responses — no live calls anywhere in this
 * suite (no key exists in this environment, and none is needed).
 *
 * The contract under test:
 *  - the model transcribes EVERY segment through the tool, and this adapter
 *    picks the leg — including when the NYC departure is the return leg, the
 *    case that shipped broken;
 *  - a bad field is dropped on its own, never taking good fields with it;
 *  - the cheap model runs alone on an unambiguous ticket, and escalates once
 *    when it comes back with nothing usable;
 *  - anything else (no tool call, API error) degrades to `unreadable` — the
 *    manual-entry path — carrying diagnostics that say why.
 */

function toolResponse(input: unknown, model = CLAUDE_EXTRACTION_MODEL) {
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "tool_use", id: "toolu_test", name: "record_itinerary", input }],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 4400, output_tokens: 380 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function textResponse(text: string) {
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: CLAUDE_EXTRACTION_MODEL,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Frozen clock, so "has this leg already flown?" is deterministic. */
const NOW = () => new Date("2026-08-29T12:00:00Z");

function extractorWith(fetchImpl: typeof fetch, escalationModel?: string | null) {
  return new ClaudeTicketExtractor({
    apiKey: "test-key-never-used-for-real",
    fetchImpl,
    log: () => {},
    now: NOW,
    ...(escalationModel === undefined ? {} : { escalationModel }),
  });
}

const input = { data: makePdf(["TICKET"]), mimeType: "application/pdf" };

const ONE_WAY = {
  paxName: "ALVAREZ/JORDAN MR",
  documentKind: "one_way",
  segments: [
    {
      originAirport: "JFK",
      destinationAirport: "SFO",
      flightNumber: "UA1189",
      departureAtLocal: "2026-09-01T18:30",
      originCountry: "US",
      destinationCountry: "US",
    },
  ],
};

describe("ClaudeTicketExtractor", () => {
  it("module construction never throws without a usable key (lazy client)", () => {
    expect(() => new ClaudeTicketExtractor({ apiKey: "" })).not.toThrow();
  });

  it("reads an ordinary one-way ticket on the cheap model alone", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toContain("/v1/messages");
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        tool_choice: { type: string; name: string };
        messages: Array<{ content: Array<{ type: string }> }>;
      };
      expect(body.model).toBe(CLAUDE_EXTRACTION_MODEL);
      expect(body.tool_choice).toEqual({ type: "tool", name: "record_itinerary" });
      expect(body.messages[0]?.content[0]?.type).toBe("document");
      return toolResponse(ONE_WAY);
    });

    const outcome = await extractorWith(fetchMock as unknown as typeof fetch).extract(input);
    // No escalation: an unambiguous read costs exactly one call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result).toMatchObject({
      flightNumber: "UA1189",
      airlineIata: "UA",
      departureAirport: "JFK",
      destinationAirport: "SFO",
      departureAtLocal: "2026-09-01T18:30",
      paxName: "Jordan Alvarez",
      scope: "domestic",
      documentKind: "one_way",
      selectionReason: "single_serviced_origin",
      confidence: "high",
    });
  });

  it("picks the NYC departure of a round trip, not the leg arriving in NYC", async () => {
    // The shipped bug, as a regression test: a Delhi-origin round trip whose
    // only serviced departure is the second leg on the page.
    const fetchMock = vi.fn(async () =>
      toolResponse({
        paxName: "Mr Karun Rathi (Adult)",
        documentKind: "round_trip",
        segments: [
          {
            originAirport: "DEL",
            destinationAirport: "JFK",
            flightNumber: "AI - 101",
            departureAtLocal: "2026-10-06T01:35",
            destinationCountry: "US",
          },
          {
            originAirport: "EWR",
            destinationAirport: "DEL",
            flightNumber: "AI144",
            departureAtLocal: "2026-09-12T13:15",
            destinationCountry: "IN",
          },
        ],
      }),
    );

    const outcome = await extractorWith(fetchMock as unknown as typeof fetch).extract(input);
    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result).toMatchObject({
      departureAirport: "EWR",
      destinationAirport: "DEL",
      flightNumber: "AI144",
      departureAtLocal: "2026-09-12T13:15",
      paxName: "Karun Rathi",
      scope: "international",
      documentKind: "round_trip",
      confidence: "high",
    });
    expect(outcome.diagnostics?.segments).toHaveLength(2);
    expect(outcome.diagnostics?.chosenIndex).toBe(1);
  });

  it("explains an origin we do not serve instead of blanking the airport", async () => {
    const fetchMock = vi.fn(async () =>
      toolResponse({
        paxName: "Alex Traveler",
        documentKind: "one_way",
        segments: [
          {
            originAirport: "SFO",
            destinationAirport: "JFK",
            flightNumber: "UA1189",
            departureAtLocal: "2026-09-03T08:15",
            destinationCountry: "US",
          },
        ],
      }),
    );

    const outcome = await extractorWith(fetchMock as unknown as typeof fetch).extract(input);
    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.departureAirport).toBeUndefined();
    expect(outcome.result.nonServicedOrigin).toBe("SFO");
    expect(outcome.result.selectionReason).toBe("no_serviced_origin");
    expect(outcome.result.confidence).toBe("low");
    // The flight details belong to a leg we cannot serve — prefilling them
    // would hand the customer a form that cannot be submitted.
    expect(outcome.result.flightNumber).toBeUndefined();
    expect(outcome.result.paxName).toBe("Alex Traveler");
  });

  it("offers the other NYC leg when the choice is genuinely ambiguous", async () => {
    const fetchMock = vi.fn(async () =>
      toolResponse({
        paxName: "Jordan Alvarez",
        documentKind: "multi_city",
        segments: [
          {
            originAirport: "JFK",
            destinationAirport: "MIA",
            flightNumber: "DL200",
            departureAtLocal: "2026-09-05T09:00",
            destinationCountry: "US",
          },
          {
            originAirport: "EWR",
            destinationAirport: "AUS",
            flightNumber: "UA300",
            departureAtLocal: "2026-09-19T09:00",
            destinationCountry: "US",
          },
        ],
      }),
    );

    const outcome = await extractorWith(fetchMock as unknown as typeof fetch, null).extract(
      input,
    );
    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.departureAirport).toBe("JFK");
    expect(outcome.result.confidence).toBe("low");
    expect(outcome.result.alternativeSegments).toEqual([
      expect.objectContaining({ originAirport: "EWR", flightNumber: "UA300" }),
    ]);
  });

  it("drops only the unreadable field, keeping the rest of the leg", async () => {
    const fetchMock = vi.fn(async () =>
      toolResponse({
        paxName: "Jordan Alvarez",
        documentKind: "one_way",
        segments: [
          {
            originAirport: "JFK",
            destinationAirport: "SFO",
            flightNumber: "UA1189",
            departureAtLocal: "sometime Tuesday",
            destinationCountry: "US",
          },
        ],
      }),
    );

    const outcome = await extractorWith(fetchMock as unknown as typeof fetch).extract(input);
    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.flightNumber).toBe("UA1189");
    expect(outcome.result.departureAirport).toBe("JFK");
    expect(outcome.result.departureAtLocal).toBeUndefined();
    expect(outcome.diagnostics?.droppedFields).toEqual([
      expect.objectContaining({ field: "segments[0].departureAtLocal" }),
    ]);
  });

  it("escalates once to the stronger model when the cheap pass finds nothing", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string; thinking?: unknown };
      calls.push(body.model);
      if (body.model === CLAUDE_EXTRACTION_MODEL) {
        return toolResponse({ documentKind: "unclear", segments: [] });
      }
      // The retry reasons about the layout; that is what it is paying for.
      expect(body.thinking).toEqual({ type: "adaptive" });
      return toolResponse(ONE_WAY, CLAUDE_ESCALATION_MODEL);
    });

    const outcome = await extractorWith(fetchMock as unknown as typeof fetch).extract(input);
    expect(calls).toEqual([CLAUDE_EXTRACTION_MODEL, CLAUDE_ESCALATION_MODEL]);
    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.departureAirport).toBe("JFK");
    expect(outcome.diagnostics?.attempts).toHaveLength(2);
    expect(outcome.diagnostics?.attempts[1]?.escalatedBecause).toContain("no_segments");
  });

  it("keeps the first pass when the escalation comes back worse", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      return body.model === CLAUDE_EXTRACTION_MODEL
        ? toolResponse({
            paxName: "Jordan Alvarez",
            documentKind: "multi_city",
            segments: [
              { originAirport: "JFK", destinationAirport: "MIA", departureAtLocal: "2026-09-05T09:00" },
              { originAirport: "EWR", destinationAirport: "AUS", departureAtLocal: "2026-09-19T09:00" },
            ],
          })
        : toolResponse({ documentKind: "unclear", segments: [] }, CLAUDE_ESCALATION_MODEL);
    });

    const outcome = await extractorWith(fetchMock as unknown as typeof fetch).extract(input);
    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.departureAirport).toBe("JFK");
  });

  it("sends a photographed ticket as an image block", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: Array<{ type: string; source?: { media_type: string } }> }>;
      };
      expect(body.messages[0]?.content[0]?.type).toBe("image");
      expect(body.messages[0]?.content[0]?.source?.media_type).toBe("image/jpeg");
      return toolResponse(ONE_WAY);
    });

    const outcome = await extractorWith(fetchMock as unknown as typeof fetch).extract({
      data: new Uint8Array([1, 2, 3]),
      mimeType: "image/jpeg",
    });
    expect(outcome.status).toBe("extracted");
  });

  it("degrades to unreadable when the model answers with prose", async () => {
    const fetchMock = vi.fn(async () => textResponse("Sure! It looks like UA1189 out of JFK."));
    const outcome = await extractorWith(fetchMock as unknown as typeof fetch, null).extract(
      input,
    );
    expect(outcome.status).toBe("unreadable");
    if (outcome.status !== "unreadable") return;
    expect(outcome.diagnostics?.attempts[0]?.rawText).toContain("UA1189");
  });

  it("degrades to unreadable on an API error, with the error in diagnostics", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ type: "error", error: { type: "api_error" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    const outcome = await extractorWith(fetchMock as unknown as typeof fetch, null).extract(
      input,
    );
    expect(outcome.status).toBe("unreadable");
    if (outcome.status !== "unreadable") return;
    expect(outcome.diagnostics?.attempts[0]?.error).toBeTruthy();
  });

  it("refuses a file type it cannot read at all", async () => {
    const fetchMock = vi.fn(async () => toolResponse(ONE_WAY));
    const outcome = await extractorWith(fetchMock as unknown as typeof fetch).extract({
      data: new Uint8Array([1]),
      mimeType: "application/zip",
    });
    expect(outcome).toEqual({
      status: "unreadable",
      reason: "no extraction for application/zip yet",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

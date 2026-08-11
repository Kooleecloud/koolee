import { describe, expect, it, vi } from "vitest";

import { CLAUDE_EXTRACTION_MODEL, ClaudeTicketExtractor } from "./claude";
import { makePdf } from "./test-utils/make-pdf";

/**
 * Claude adapter with MOCKED API responses — no live calls anywhere in this
 * suite (no key exists in this environment, and none is needed). The
 * contract under test: strict JSON in → validated result; anything else
 * (malformed JSON, API error, schema violations) degrades to `unreadable` —
 * the manual-entry path — and never crashes or persists a guess.
 */

function messagesResponse(text: string) {
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

function extractorWith(fetchImpl: typeof fetch) {
  return new ClaudeTicketExtractor({
    apiKey: "test-key-never-used-for-real",
    fetchImpl,
    log: () => {},
  });
}

const input = { data: makePdf(["TICKET"]), mimeType: "application/pdf" };

describe("ClaudeTicketExtractor", () => {
  it("module construction never throws without a usable key (lazy client)", () => {
    expect(() => new ClaudeTicketExtractor({ apiKey: "" })).not.toThrow();
  });

  it("parses and validates a good strict-JSON reply", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      // Assert the request really is a Messages call carrying a PDF block
      // and the single model constant.
      expect(String(url)).toContain("/v1/messages");
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ content: Array<{ type: string }> }>;
      };
      expect(body.model).toBe(CLAUDE_EXTRACTION_MODEL);
      expect(body.messages[0]?.content[0]?.type).toBe("document");

      return messagesResponse(
        JSON.stringify({
          airlineIata: "UA",
          flightNumber: "UA1189",
          departureAtLocal: "2026-09-01T18:30",
          departureAirport: "JFK",
          destinationAirport: "SFO",
          paxName: "Jordan Alvarez",
          scope: "domestic",
          confidence: "high",
        }),
      );
    });

    const outcome = await extractorWith(fetchMock as unknown as typeof fetch).extract(
      input,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.flightNumber).toBe("UA1189");
    expect(outcome.result.departureAirport).toBe("JFK");
  });

  it("tolerates markdown fences around the JSON", async () => {
    const fetchMock = vi.fn(async () =>
      messagesResponse('```json\n{"flightNumber":"DL123","confidence":"high"}\n```'),
    );
    const outcome = await extractorWith(fetchMock as unknown as typeof fetch).extract(
      input,
    );
    expect(outcome.status).toBe("extracted");
  });

  it("degrades to unreadable on malformed JSON — never a crash", async () => {
    const fetchMock = vi.fn(async () =>
      messagesResponse("Sure! The flight appears to be UA1189 out of JFK."),
    );
    const outcome = await extractorWith(fetchMock as unknown as typeof fetch).extract(
      input,
    );
    expect(outcome).toEqual({ status: "unreadable", reason: "model reply was not JSON" });
  });

  it("drops a non-NYC origin during server-side validation (LAX cannot proceed)", async () => {
    const fetchMock = vi.fn(async () =>
      messagesResponse(
        JSON.stringify({
          flightNumber: "AA100",
          departureAirport: "LAX",
          confidence: "high",
        }),
      ),
    );
    const outcome = await extractorWith(fetchMock as unknown as typeof fetch).extract(
      input,
    );
    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.departureAirport).toBeUndefined();
    expect(outcome.result.confidence).toBe("low");
  });

  it("degrades to unreadable on an API error — the funnel falls back to manual entry", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "overloaded_error", message: "Overloaded" },
          }),
          { status: 529, headers: { "content-type": "application/json" } },
        ),
    );
    const outcome = await extractorWith(fetchMock as unknown as typeof fetch).extract(
      input,
    );
    expect(outcome).toEqual({
      status: "unreadable",
      reason: "extraction service unavailable",
    });
  });

  it("reports an empty extraction as unreadable rather than prefilling nothing", async () => {
    const fetchMock = vi.fn(async () => messagesResponse('{"confidence":"low"}'));
    const outcome = await extractorWith(fetchMock as unknown as typeof fetch).extract(
      input,
    );
    expect(outcome.status).toBe("unreadable");
  });
});

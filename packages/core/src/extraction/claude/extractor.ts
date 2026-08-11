import type Anthropic from "@anthropic-ai/sdk";
import { AIRPORT_CODES } from "@koolee/db";

import {
  ticketExtractionSchema,
  type TicketExtractionOutcome,
  type TicketExtractor,
  type TicketFileInput,
} from "../types";

/**
 * Anthropic API adapter — the ONE place in `packages/core` allowed to import
 * the Anthropic SDK (ESLint-enforced, like the Stripe boundary).
 *
 *  - The PDF goes to the model as a native document block (base64); no
 *    client-side text extraction.
 *  - The model is prompted for strict JSON matching the zod schema, and the
 *    response is parsed AND validated server-side — a malformed or
 *    schema-violating reply degrades to `unreadable` (manual entry), never a
 *    crash and never persisted.
 *  - LAZY construction: the SDK client is created on first `extract()` call,
 *    so importing this module never throws when no API key exists. The key
 *    is injected by the app (core reads no env).
 */

/** Haiku-class: current small/fast tier. The one place the model ID lives. */
export const CLAUDE_EXTRACTION_MODEL = "claude-haiku-4-5";

const MAX_OUTPUT_TOKENS = 1024;

const EXTRACTION_PROMPT = `You are extracting flight details from an airline e-ticket for a luggage-pickup service that operates ONLY out of New York City airports (JFK, LGA, EWR).

Return ONLY a JSON object — no prose, no markdown fences — with exactly these keys (omit a key entirely when the ticket does not clearly state it; never guess):

{
  "airlineIata": "two-character IATA airline code, e.g. UA",
  "flightNumber": "IATA flight number with no spaces, e.g. UA1189",
  "departureAtLocal": "departure date and local time as YYYY-MM-DDTHH:mm",
  "departureAirport": "IATA code of the departure airport, ONLY if it is JFK, LGA, or EWR — otherwise omit",
  "destinationAirport": "IATA code of the destination airport",
  "paxName": "passenger name as First Last",
  "scope": "domestic" or "international" based on the destination country,
  "confidence": "high" or "low"
}

Rules:
- If the itinerary has multiple segments, use the segment departing JFK, LGA, or EWR. If more than one segment departs those airports and you cannot tell which one this pickup is for, set "confidence" to "low".
- Set "confidence" to "low" whenever any field is uncertain.
- If you cannot read the document at all, return {"confidence": "low"}.`;

export interface ClaudeTicketExtractorOptions {
  /** Injected by the app layer (core reads no env). */
  apiKey: string;
  /** Injectable for tests — passed straight to the SDK client. */
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

export class ClaudeTicketExtractor implements TicketExtractor {
  readonly name = "claude";

  private readonly options: ClaudeTicketExtractorOptions;
  private client: Anthropic | null = null;

  constructor(options: ClaudeTicketExtractorOptions) {
    this.options = options;
  }

  /** SDK construction deferred to first use — module import never throws. */
  private async getClient(): Promise<Anthropic> {
    if (!this.client) {
      const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
      this.client = new AnthropicClient({
        apiKey: this.options.apiKey,
        ...(this.options.fetchImpl ? { fetch: this.options.fetchImpl } : {}),
      });
    }
    return this.client;
  }

  async extract(input: TicketFileInput): Promise<TicketExtractionOutcome> {
    const log = this.options.log ?? ((m: string) => console.warn(`[claude-extract] ${m}`));

    if (input.mimeType !== "application/pdf") {
      return {
        status: "unreadable",
        reason: `no extraction for ${input.mimeType} yet`,
      };
    }

    let text: string;
    try {
      const client = await this.getClient();
      const response = await client.messages.create({
        model: CLAUDE_EXTRACTION_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: toBase64(input.data),
                },
              },
              { type: "text", text: EXTRACTION_PROMPT },
            ],
          },
        ],
      });
      const block = response.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") {
        return { status: "unreadable", reason: "model returned no text" };
      }
      text = block.text;
    } catch (error) {
      // API failure degrades to manual entry — never a crash in the funnel.
      log(`extraction call failed: ${error instanceof Error ? error.message : error}`);
      return { status: "unreadable", reason: "extraction service unavailable" };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(stripFences(text));
    } catch {
      return { status: "unreadable", reason: "model reply was not JSON" };
    }

    // Server-side validation is the trust boundary: anything the model got
    // wrong (bad code shapes, a non-NYC origin) is dropped or rejected here.
    const parsed = ticketExtractionSchema.safeParse(scrub(raw));
    if (!parsed.success) {
      return { status: "unreadable", reason: "model reply failed validation" };
    }
    if (
      !parsed.data.flightNumber &&
      !parsed.data.departureAtLocal &&
      !parsed.data.paxName
    ) {
      return { status: "unreadable", reason: "no flight details found" };
    }
    return { status: "extracted", result: parsed.data };
  }
}

/** Drop unknown keys and any non-serviced departureAirport before validating. */
function scrub(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const record = raw as Record<string, unknown>;
  const keys = [
    "airlineIata",
    "flightNumber",
    "departureAtLocal",
    "departureAirport",
    "destinationAirport",
    "paxName",
    "scope",
    "confidence",
  ] as const;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
      out[key] = record[key];
    }
  }
  if (
    typeof out.departureAirport === "string" &&
    !(AIRPORT_CODES as readonly string[]).includes(out.departureAirport)
  ) {
    delete out.departureAirport;
    out.confidence = "low";
  }
  if (out.confidence !== "high" && out.confidence !== "low") out.confidence = "low";
  return out;
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

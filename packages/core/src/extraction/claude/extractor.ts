import type Anthropic from "@anthropic-ai/sdk";

import {
  deriveScope,
  normalizeSegment,
  selectSegment,
  todayUtc,
  type DroppedField,
  type SegmentSelection,
} from "../select-segment";
import {
  DOCUMENT_KINDS,
  type ExtractedSegment,
  type TicketDocumentKind,
  type TicketExtractionAttempt,
  type TicketExtractionDiagnostics,
  type TicketExtractionOutcome,
  type TicketExtractionResult,
  type TicketExtractor,
  type TicketFileInput,
} from "../types";

/**
 * Anthropic API adapter — the ONE place in `packages/core` allowed to import
 * the Anthropic SDK (ESLint-enforced, like the Stripe boundary).
 *
 * The shape of the ask is the whole design:
 *
 *  - the model records EVERY segment on the document through a tool schema,
 *    and `selectSegment` picks the leg. Asking for one pre-filtered answer
 *    made a round-trip e-ticket come back as the leg that ARRIVES in New
 *    York — reading and choosing at once is a job the cheap model fails, and
 *    the choice is deterministic anyway, so it belongs in our code;
 *  - a forced `tool_use` replaces free-text JSON, so there is no fence to
 *    strip and no prose to fail to parse;
 *  - every value is coerced and validated FIELD BY FIELD, so one malformed
 *    timestamp no longer discards a perfectly good flight number;
 *  - a cheap first pass escalates ONCE to the stronger model, and only when
 *    the cheap pass came back with nothing usable or something ambiguous;
 *  - LAZY construction: the SDK client is created on first `extract()` call,
 *    so importing this module never throws when no API key exists. The key
 *    is injected by the app (core reads no env).
 *
 * The HARD RULE in `../types.ts` is unchanged: nothing here is a fact, all of
 * it is a prefill for the review form the customer must confirm.
 */

/** Haiku-class first pass — right on ordinary tickets, ~$0.007 a document. */
export const CLAUDE_EXTRACTION_MODEL = "claude-haiku-4-5";

/**
 * The one retry, for documents the cheap pass could not resolve: a scrambled
 * OTA layout, an ambiguous multi-leg itinerary, nothing found at all. Roughly
 * double the cost, on a small fraction of uploads.
 */
export const CLAUDE_ESCALATION_MODEL = "claude-sonnet-5";

const MAX_OUTPUT_TOKENS = 4096;

/** Images Claude reads natively — people photograph tickets. */
const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png"] as const;

const TOOL_NAME = "record_itinerary";

/**
 * One tool, one job: transcribe the itinerary. Every hint that earns its place
 * here came from a document that got it wrong — the guidance about durations,
 * about terminal names, and about print order are all failures observed on
 * real e-tickets, not speculation.
 */
const ITINERARY_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Record every flight segment printed on this e-ticket, plus the passenger. " +
    "Transcribe what the document says; do not decide which segment matters.",
  input_schema: {
    type: "object",
    properties: {
      paxName: {
        type: "string",
        description:
          "The primary passenger's name as 'First Last'. Ticket convention prints " +
          "'SURNAME/GIVEN' — convert that to 'Given Surname'. Drop titles (Mr, Ms, Mrs) " +
          "and suffixes like '(Adult)'.",
      },
      documentKind: {
        type: "string",
        enum: [...DOCUMENT_KINDS],
        description:
          "one_way for a single journey, round_trip when the itinerary returns to where " +
          "it started, multi_city otherwise, unclear when you cannot tell.",
      },
      segments: {
        type: "array",
        description:
          "EVERY flight segment on the document, including return legs and connections.",
        items: {
          type: "object",
          properties: {
            originAirport: {
              type: "string",
              description:
                "IATA 3-letter code of the airport this segment DEPARTS from. Map airport " +
                "and terminal names to codes — 'Newark Liberty, T-B' is EWR, 'John F Kennedy, " +
                "T-4' is JFK, 'LaGuardia' is LGA, 'Indira Gandhi' is DEL, 'Heathrow' is LHR. " +
                "If the document names only a CITY that has several airports (e.g. 'New York', " +
                "'London'), use a code confirmed elsewhere on the document — a fare or baggage " +
                "line like 'EWR - DEL' often carries it — and omit this field if nothing " +
                "confirms which airport it is.",
            },
            destinationAirport: {
              type: "string",
              description: "IATA 3-letter code of the airport this segment ARRIVES at.",
            },
            flightNumber: {
              type: "string",
              description:
                "The marketing flight number, e.g. AI144. Printed forms like 'AI - 101' and " +
                "'UA 1189' are the same thing.",
            },
            airlineIata: {
              type: "string",
              description: "IATA airline code, e.g. AI, UA, B6.",
            },
            departureAtLocal: {
              type: "string",
              description:
                "Scheduled DEPARTURE date and time, local at the origin airport, as " +
                "YYYY-MM-DDTHH:mm. Never the arrival time. Never the flight DURATION — " +
                "e-tickets print durations right next to departure times, in forms like " +
                "'15:30 Hrs' beside a route header; a duration is an elapsed length, not a " +
                "clock time. If the year is not printed, infer it from the rest of the " +
                "document and say so in notes.",
            },
            originCountry: {
              type: "string",
              description:
                "ISO-3166 alpha-2 country of the ORIGIN airport, e.g. US, IN, GB.",
            },
            destinationCountry: {
              type: "string",
              description:
                "ISO-3166 alpha-2 country of the DESTINATION airport. This is what decides " +
                "whether the flight is domestic, so give it whenever you know the airport.",
            },
            notes: {
              type: "string",
              description: "Anything ambiguous or inferred about this segment.",
            },
          },
          required: ["originAirport", "destinationAirport"],
        },
      },
      readingNotes: {
        type: "string",
        description: "What was hard to read on this document, if anything.",
      },
    },
    required: ["segments", "documentKind"],
  },
};

function buildPrompt(today: string): string {
  return `Read this airline e-ticket and record EVERY flight segment printed on it using the ${TOOL_NAME} tool.

Today's date is ${today}.

How to read these documents:
- Round-trip and multi-city tickets contain more than one segment. Record all of them, in the order they appear. Do not pick a favourite and do not leave one out — which segment matters is decided downstream, not by you.
- Booking sites often print segments out of chronological order, and the extracted text layer can interleave the columns of a table. Trust the dates and the airport codes over the order things appear in.
- Times printed on e-tickets are local at the airport concerned. A value labelled as a duration ("15:30 Hrs", "Non Stop", "Duration") is never a departure time.
- Terminal names, airport names and city names all need mapping to IATA codes. If a city has several airports and the document does not confirm which one, leave the code out rather than guessing.
- Omit any field you cannot read. Never invent a value. Put anything you inferred or found ambiguous into "notes".`;
}

export interface ClaudeTicketExtractorOptions {
  /** Injected by the app layer (core reads no env). */
  apiKey: string;
  /** Injectable for tests — passed straight to the SDK client. */
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  /** Injectable clock; the reference date for "has this leg already flown?". */
  now?: () => Date;
  /**
   * Set to `null` to disable the retry on the stronger model (tests, or a
   * deployment that wants a hard per-upload cost ceiling).
   */
  escalationModel?: string | null;
}

/** One model call plus everything we learned from it. */
interface Pass {
  attempt: TicketExtractionAttempt;
  segments: ExtractedSegment[];
  dropped: DroppedField[];
  selection: SegmentSelection;
  paxName?: string;
  documentKind?: TicketDocumentKind;
  readingNotes?: string;
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
        // The customer is standing on the flight step while this runs, and a
        // failed pass already gets one retry on the stronger model. The SDK's
        // default of two more retries on top of that turns a bad minute at
        // the API into a minute of staring at a spinner.
        maxRetries: 1,
        timeout: 60_000,
        ...(this.options.fetchImpl ? { fetch: this.options.fetchImpl } : {}),
      });
    }
    return this.client;
  }

  async extract(input: TicketFileInput): Promise<TicketExtractionOutcome> {
    const log =
      this.options.log ?? ((m: string) => console.warn(`[claude-extract] ${m}`));
    const today = todayUtc(this.options.now?.() ?? new Date());

    const source = documentBlock(input);
    if (!source) {
      return { status: "unreadable", reason: `no extraction for ${input.mimeType} yet` };
    }

    const first = await this.runPass({
      model: CLAUDE_EXTRACTION_MODEL,
      source,
      today,
      log,
    });

    // Escalate only when the cheap pass left us without a usable leg or with
    // a choice it could not make confidently. An ordinary one-way or round
    // trip resolves on the first call and never pays for the second.
    const escalationModel =
      this.options.escalationModel === undefined
        ? CLAUDE_ESCALATION_MODEL
        : this.options.escalationModel;
    const escalationTrigger = triggerFor(first);
    if (escalationModel && escalationTrigger) {
      const second = await this.runPass({
        model: escalationModel,
        source,
        today,
        log,
        thinking: true,
        escalatedBecause: escalationTrigger,
      });
      return this.finish(isBetter(second, first) ? second : first, [
        first.attempt,
        second.attempt,
      ]);
    }

    return this.finish(first, [first.attempt]);
  }

  /** One model call: request, read the tool input, coerce, choose a leg. */
  private async runPass(args: {
    model: string;
    source: Anthropic.ContentBlockParam;
    today: string;
    log: (message: string) => void;
    thinking?: boolean;
    escalatedBecause?: string;
  }): Promise<Pass> {
    const startedAt = Date.now();
    const attempt: TicketExtractionAttempt = {
      model: args.model,
      latencyMs: 0,
      ...(args.escalatedBecause ? { escalatedBecause: args.escalatedBecause } : {}),
    };

    let toolInput: unknown;
    try {
      const client = await this.getClient();
      const response = await client.messages.create({
        model: args.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        tools: [ITINERARY_TOOL],
        tool_choice: { type: "tool", name: TOOL_NAME },
        // Adaptive thinking on the escalation pass only: the retry exists
        // precisely for documents that need reasoning, and it is the reason
        // the stronger model reads a scrambled layout correctly.
        ...(args.thinking ? { thinking: { type: "adaptive" as const } } : {}),
        messages: [
          {
            role: "user",
            content: [args.source, { type: "text", text: buildPrompt(args.today) }],
          },
        ],
      });
      attempt.latencyMs = Date.now() - startedAt;
      attempt.usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
      const block = response.content.find(
        (b) => b.type === "tool_use" && b.name === TOOL_NAME,
      );
      if (block?.type === "tool_use") {
        toolInput = block.input;
        attempt.rawToolInput = block.input;
      } else {
        const text = response.content.find((b) => b.type === "text");
        attempt.rawText = text?.type === "text" ? text.text : "";
        attempt.error = "model did not call the tool";
      }
    } catch (error) {
      // API failure degrades to manual entry — never a crash in the funnel.
      attempt.latencyMs = Date.now() - startedAt;
      attempt.error = error instanceof Error ? error.message : String(error);
      args.log(`extraction call failed (${args.model}): ${attempt.error}`);
    }

    return { attempt, ...readItinerary(toolInput, args.today) };
  }

  /** Assemble the outcome and its diagnostics from the winning pass. */
  private finish(
    best: Pass,
    attempts: TicketExtractionAttempt[],
  ): TicketExtractionOutcome {
    const diagnostics: TicketExtractionDiagnostics = {
      extractor: this.name,
      attempts,
      segments: best.segments,
      chosenIndex: best.selection.chosenIndex,
      selectionReason: best.selection.reason,
      droppedFields: best.dropped,
      ...(best.readingNotes ? { readingNotes: best.readingNotes } : {}),
    };

    const chosen = best.selection.chosen;
    const scope = deriveScope(chosen);
    const result: TicketExtractionResult = {
      ...(chosen?.flightNumber ? { flightNumber: chosen.flightNumber } : {}),
      ...(chosen?.airlineIata ? { airlineIata: chosen.airlineIata } : {}),
      ...(chosen?.departureAtLocal ? { departureAtLocal: chosen.departureAtLocal } : {}),
      // Only a SERVICED origin ever reaches the form; `selectSegment` has
      // already guaranteed it, and `nonServicedOrigin` carries the rest.
      ...(best.selection.chosenOrigin
        ? { departureAirport: best.selection.chosenOrigin }
        : {}),
      ...(chosen?.destinationAirport
        ? { destinationAirport: chosen.destinationAirport }
        : {}),
      ...(best.paxName ? { paxName: best.paxName } : {}),
      ...(scope ? { scope } : {}),
      ...(best.documentKind ? { documentKind: best.documentKind } : {}),
      ...(best.selection.nonServicedOrigin
        ? { nonServicedOrigin: best.selection.nonServicedOrigin }
        : {}),
      ...(best.selection.alternatives.length > 0
        ? { alternativeSegments: best.selection.alternatives }
        : {}),
      selectionReason: best.selection.reason,
      confidence: best.selection.confidence,
    };

    // Nothing at all to show: no leg, no name. That is the manual-entry path.
    // A ticket out of an airport we do not serve is NOT this case — it has a
    // reason worth telling the customer, and the review form tells them.
    if (!result.paxName && !result.flightNumber && !result.departureAtLocal) {
      const reason =
        attempts.at(-1)?.error ??
        (best.segments.length === 0 ? "no flight details found" : "no usable segment");
      return { status: "unreadable", reason, diagnostics };
    }
    return { status: "extracted", result, diagnostics };
  }
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/** The uploaded bytes as the content block its media type calls for. */
function documentBlock(input: TicketFileInput): Anthropic.ContentBlockParam | null {
  const data = toBase64(input.data);
  if (input.mimeType === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data },
    };
  }
  if ((SUPPORTED_IMAGE_TYPES as readonly string[]).includes(input.mimeType)) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: input.mimeType as (typeof SUPPORTED_IMAGE_TYPES)[number],
        data,
      },
    };
  }
  return null;
}

/**
 * Coerce the model's tool input into segments and choose a leg. Every field is
 * checked on its own; whatever fails is recorded in `dropped` and skipped,
 * never allowed to sink the fields that did parse.
 */
function readItinerary(raw: unknown, today: string): Omit<Pass, "attempt"> {
  const record =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const rawSegments = Array.isArray(record.segments) ? record.segments : [];

  const dropped: DroppedField[] = [];
  const segments: ExtractedSegment[] = [];
  for (const [index, entry] of rawSegments.entries()) {
    const normalized = normalizeSegment(entry, index);
    dropped.push(...normalized.dropped);
    segments.push(normalized.segment);
  }

  const selection = selectSegment(segments, { today });

  const paxName = cleanName(record.paxName);
  if (record.paxName !== undefined && paxName === undefined) {
    dropped.push({
      field: "paxName",
      value: record.paxName,
      reason: "unusable passenger name",
    });
  }

  const documentKind =
    typeof record.documentKind === "string" &&
    (DOCUMENT_KINDS as readonly string[]).includes(record.documentKind)
      ? (record.documentKind as TicketDocumentKind)
      : undefined;

  const readingNotes =
    typeof record.readingNotes === "string" && record.readingNotes.trim() !== ""
      ? record.readingNotes.trim().slice(0, 1000)
      : undefined;

  return {
    segments,
    dropped,
    selection,
    ...(paxName ? { paxName } : {}),
    ...(documentKind ? { documentKind } : {}),
    ...(readingNotes ? { readingNotes } : {}),
  };
}

/** "ALVAREZ/JORDAN MR" → "Jordan Alvarez"; anything unusable → undefined. */
function cleanName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const stripped = raw
    .replace(/\((?:adult|child|infant)\)/gi, "")
    .replace(/\b(mr|mrs|ms|miss|dr|master)\b\.?/gi, "")
    .trim();
  const ordered = stripped.includes("/")
    ? stripped.split("/").reverse().join(" ")
    : stripped;
  const words = ordered.split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const name = words
    .map((w) =>
      /[a-z]/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(" ");
  return name.length > 120 ? undefined : name;
}

/** Why the cheap pass is not good enough, or undefined when it is. */
function triggerFor(pass: Pass): string | undefined {
  if (pass.attempt.error) return `first pass failed: ${pass.attempt.error}`;
  if (pass.selection.chosen === undefined) return `first pass: ${pass.selection.reason}`;
  if (pass.selection.confidence === "low") return `first pass: ${pass.selection.reason}`;
  return undefined;
}

/**
 * Did the retry actually help? A pass that found a serviced leg beats one that
 * did not; a confident choice beats an unsure one; otherwise keep the first,
 * so a flaky second call can never make the answer worse.
 */
function isBetter(candidate: Pass, incumbent: Pass): boolean {
  if (candidate.attempt.error) return false;
  const candidateHasLeg = candidate.selection.chosen !== undefined;
  const incumbentHasLeg = incumbent.selection.chosen !== undefined;
  if (candidateHasLeg !== incumbentHasLeg) return candidateHasLeg;
  if (candidate.selection.confidence !== incumbent.selection.confidence) {
    return candidate.selection.confidence === "high";
  }
  return candidate.segments.length > incumbent.segments.length;
}

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

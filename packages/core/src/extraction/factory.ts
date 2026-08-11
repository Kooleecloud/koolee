import { ClaudeTicketExtractor } from "./claude";
import { FakeTicketExtractor } from "./fake";
import { HeuristicTicketExtractor } from "./heuristic";
import type { TicketExtractionResult, TicketExtractor } from "./types";

/**
 * Extractor selection, mirroring `createPaymentProvider`.
 *
 * The app decides the kind from ITS env (`ANTHROPIC_API_KEY` present →
 * claude, else heuristic) and injects plain values here — one env var is the
 * whole plug-and-play switch, and core still reads no env. Construction is
 * cheap and lazy either way: no adapter touches the network until
 * `extract()` runs.
 */
export type TicketExtractorConfig =
  | { kind: "fake"; result?: TicketExtractionResult }
  | { kind: "heuristic" }
  | { kind: "claude"; apiKey: string };

export function createTicketExtractor(config: TicketExtractorConfig): TicketExtractor {
  switch (config.kind) {
    case "fake":
      return new FakeTicketExtractor(config.result);
    case "heuristic":
      return new HeuristicTicketExtractor();
    case "claude":
      return new ClaudeTicketExtractor({ apiKey: config.apiKey });
  }
}

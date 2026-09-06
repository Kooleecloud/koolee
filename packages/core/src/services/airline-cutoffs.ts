import { and, asc, eq } from "drizzle-orm";
import {
  airlineCutoffs,
  type AirlineCutoff,
  type AirportCode,
  type CutoffScope,
  type Database,
} from "@koolee/db";

import { InvalidInputError, NotFoundError } from "../errors";

/**
 * The airline bag-drop cutoff matrix, as ops verifies it.
 *
 * THE MOST SAFETY-CRITICAL DATA IN THE DATABASE. Every sellable pickup window
 * is derived from these numbers: too generous and a booking is sold that
 * cannot make its flight. The seed writes 128 rows at a flat 45 (domestic) /
 * 60 (international) minutes, and stamps every one of them
 * `seed: placeholder — VERIFY … before production use`.
 *
 * Until Tier 5 there was no way to correct one but SQL. There is now, and the
 * `source` column is the point of it: a verified row says where the number
 * came from, so the next person does not have to re-verify it or, worse,
 * assume somebody did.
 *
 * Rows are UPDATED rather than versioned. The schema keeps `effective_from`
 * and could carry history, but a cutoff is a fact about an airline's counter
 * rather than a commercial decision — nobody asks "what did we think Delta's
 * cutoff was in March", and 128 rows × a history is a matrix nobody can read.
 */

/** How the seed stamps a row it invented. Anything starting with this is unverified. */
export const PLACEHOLDER_SOURCE_PREFIX = "seed: placeholder";

export interface AirlineCutoffRow extends AirlineCutoff {
  /** True while `source` still carries the seed's placeholder stamp. */
  placeholder: boolean;
}

export function isPlaceholderCutoff(row: Pick<AirlineCutoff, "source">): boolean {
  return (row.source ?? "").trimStart().startsWith(PLACEHOLDER_SOURCE_PREFIX);
}

export interface ListAirlineCutoffsResult {
  rows: AirlineCutoffRow[];
  total: number;
  /** How many are still the seed's invention. The launch-readiness number. */
  placeholders: number;
}

export async function listAirlineCutoffs(
  db: Database,
  filter: { airportCode?: AirportCode } = {},
): Promise<ListAirlineCutoffsResult> {
  const rows = await db
    .select()
    .from(airlineCutoffs)
    .where(
      filter.airportCode ? eq(airlineCutoffs.airportCode, filter.airportCode) : undefined,
    )
    .orderBy(
      asc(airlineCutoffs.airportCode),
      asc(airlineCutoffs.airlineIata),
      asc(airlineCutoffs.scope),
    );

  const decorated = rows.map((row) => ({
    ...row,
    placeholder: isPlaceholderCutoff(row),
  }));
  return {
    rows: decorated,
    total: decorated.length,
    placeholders: decorated.filter((r) => r.placeholder).length,
  };
}

/**
 * Bounds on a cutoff, and why they are these.
 *
 * The floor is 10 minutes: an airline that stops taking bags less than ten
 * minutes before push-back is not a policy, it is a typo, and the whole
 * window calculation would hand the customer time that does not exist. The
 * ceiling is 480 (eight hours) — beyond that nothing is sellable anyway, and
 * a stray extra zero is the mistake this catches.
 */
const MIN_CUTOFF_MINUTES = 10;
const MAX_CUTOFF_MINUTES = 480;

export interface UpdateAirlineCutoffInput {
  id: string;
  cutoffMinutesBeforeDeparture: number;
  /**
   * Where the number came from — an airline page, a call, a contract. Required
   * on an edit, because a corrected number with no provenance is a number the
   * next person has to verify from scratch.
   */
  source: string;
}

export async function updateAirlineCutoff(
  db: Database,
  input: UpdateAirlineCutoffInput,
): Promise<AirlineCutoffRow> {
  const minutes = input.cutoffMinutesBeforeDeparture;
  if (
    !Number.isInteger(minutes) ||
    minutes < MIN_CUTOFF_MINUTES ||
    minutes > MAX_CUTOFF_MINUTES
  ) {
    throw new InvalidInputError(
      `A cutoff must be a whole number between ${MIN_CUTOFF_MINUTES} and ${MAX_CUTOFF_MINUTES} minutes before departure.`,
    );
  }
  const source = input.source.trim();
  if (source.length === 0) {
    throw new InvalidInputError(
      "Say where the number came from — an airline page, a call, a contract. A cutoff nobody can trace is one somebody has to verify again.",
    );
  }
  if (source.startsWith(PLACEHOLDER_SOURCE_PREFIX)) {
    throw new InvalidInputError(
      "That is the seed's own placeholder text. Replace it with a real source.",
    );
  }

  const [updated] = await db
    .update(airlineCutoffs)
    .set({
      cutoffMinutesBeforeDeparture: minutes,
      source,
      effectiveFrom: new Date(),
    })
    .where(eq(airlineCutoffs.id, input.id))
    .returning();

  if (!updated) throw new NotFoundError("Airline cutoff", input.id);
  return { ...updated, placeholder: isPlaceholderCutoff(updated) };
}

export interface CreateAirlineCutoffInput {
  airlineIata: string;
  airportCode: AirportCode;
  scope: CutoffScope;
  cutoffMinutesBeforeDeparture: number;
  source: string;
}

/**
 * Adds a row for an airline the seed never knew about.
 *
 * `resolveStrictestCutoffMinutes` REFUSES TO SELL when no row exists for an
 * airline at an airport, which is the right default — but it means a real
 * carrier missing from the matrix is a carrier Koolee cannot serve until
 * somebody can add it without a migration.
 */
export async function createAirlineCutoff(
  db: Database,
  input: CreateAirlineCutoffInput,
): Promise<AirlineCutoffRow> {
  const iata = input.airlineIata.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,3}$/.test(iata)) {
    throw new InvalidInputError(
      "An airline code is two or three letters or digits, like DL or 9W.",
    );
  }

  const existing = await db
    .select({ id: airlineCutoffs.id })
    .from(airlineCutoffs)
    .where(
      and(
        eq(airlineCutoffs.airlineIata, iata),
        eq(airlineCutoffs.airportCode, input.airportCode),
        eq(airlineCutoffs.scope, input.scope),
      ),
    )
    .limit(1);
  if (existing[0]) {
    throw new InvalidInputError(
      `${iata} already has a ${input.scope} cutoff at ${input.airportCode}. Edit that row instead.`,
    );
  }

  const [created] = await db
    .insert(airlineCutoffs)
    .values({
      airlineIata: iata,
      airportCode: input.airportCode,
      scope: input.scope,
      cutoffMinutesBeforeDeparture: input.cutoffMinutesBeforeDeparture,
      source: input.source.trim(),
    })
    .returning();

  if (!created) throw new Error("Insert of airline cutoff returned no row");
  return { ...created, placeholder: isPlaceholderCutoff(created) };
}

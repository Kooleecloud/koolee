import type { PositionFix } from "@koolee/api-contract";

/**
 * Rows per INSERT. Three bound values a row, so 600 per statement — far under
 * SQLite's parameter ceiling (32766 since 3.32; 999 on older builds, which
 * this also clears).
 */
export const POSITION_INSERT_CHUNK = 200;

export interface Statement {
  sql: string;
  params: (string | number)[];
}

/**
 * The INSERTs that append a batch of fixes to `position_queue`: one
 * multi-row statement per chunk. A single statement is atomic on its own,
 * which is all a batch of fixes needs — see `enqueuePositions` for why there
 * is no BEGIN/COMMIT around them. A fix without a device timestamp is
 * stamped `now`.
 */
export function positionInserts(
  fixes: readonly PositionFix[],
  now: Date = new Date(),
): Statement[] {
  const statements: Statement[] = [];
  for (let i = 0; i < fixes.length; i += POSITION_INSERT_CHUNK) {
    const chunk = fixes.slice(i, i + POSITION_INSERT_CHUNK);
    statements.push({
      sql: `INSERT INTO position_queue (lat, lng, recorded_at) VALUES ${chunk
        .map(() => "(?, ?, ?)")
        .join(", ")}`,
      params: chunk.flatMap((fix) => [
        fix.lat,
        fix.lng,
        fix.recordedAt ?? now.toISOString(),
      ]),
    });
  }
  return statements;
}

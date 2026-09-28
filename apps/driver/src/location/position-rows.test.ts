import { describe, expect, it } from "vitest";

import { POSITION_INSERT_CHUNK, positionInserts } from "./position-rows";

const fix = (n: number) => ({
  lat: 40 + n / 1000,
  lng: -74 - n / 1000,
  recordedAt: `2026-09-27T12:00:${String(n % 60).padStart(2, "0")}.000Z`,
});

describe("positionInserts", () => {
  it("writes nothing for an empty batch", () => {
    expect(positionInserts([])).toEqual([]);
  });

  it("appends a batch as ONE statement, in order", () => {
    const [only, ...rest] = positionInserts([fix(1), fix(2)]);
    expect(rest).toEqual([]);
    expect(only!.sql).toBe(
      "INSERT INTO position_queue (lat, lng, recorded_at) VALUES (?, ?, ?), (?, ?, ?)",
    );
    expect(only!.params).toEqual([
      fix(1).lat,
      fix(1).lng,
      fix(1).recordedAt,
      fix(2).lat,
      fix(2).lng,
      fix(2).recordedAt,
    ]);
  });

  it("splits a backlog into chunks whose placeholders match their values", () => {
    const fixes = Array.from({ length: POSITION_INSERT_CHUNK * 2 + 5 }, (_, n) => fix(n));
    const statements = positionInserts(fixes);
    expect(statements.map((s) => s.params.length / 3)).toEqual([
      POSITION_INSERT_CHUNK,
      POSITION_INSERT_CHUNK,
      5,
    ]);
    for (const s of statements) {
      expect(s.sql.match(/\?/g)?.length).toBe(s.params.length);
    }
    // Oldest first across the chunk boundary: the queue sends by id.
    expect(statements[1]!.params[2]).toBe(fix(POSITION_INSERT_CHUNK).recordedAt);
  });

  it("stamps a fix that has no device time with now", () => {
    const now = new Date("2026-09-27T21:04:05.000Z");
    const [only] = positionInserts([{ lat: 1, lng: 2 }], now);
    expect(only!.params).toEqual([1, 2, "2026-09-27T21:04:05.000Z"]);
  });
});

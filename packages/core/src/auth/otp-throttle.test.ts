import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@koolee/db";

import { hashDestination } from "./hash-destination";
import {
  OTP_MAX_SENDS_PER_DESTINATION,
  OTP_MAX_SENDS_PER_USER,
  recordOtpSend,
} from "./otp-throttle";

const KEY = "k".repeat(64);
const USER_ID = "00000000-0000-4000-8000-000000000001";
const PHONE = "+13322602829";

interface FakeDbState {
  /** Operation order inside the transaction: "lock(<param>)" | "count" | "insert". */
  ops: string[];
  inserted: Array<Record<string, unknown>>;
}

/**
 * Values bound into a drizzle sql`` template — everything in `queryChunks`
 * that is not a StringChunk (its `value` is a string[]) or a nested SQL.
 */
function sqlParams(query: unknown): unknown[] {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .filter((c) => {
      if (typeof c !== "object" || c === null) return true; // raw bound value
      if ("queryChunks" in c) return false; // nested SQL
      return !("value" in c && Array.isArray((c as { value: unknown }).value));
    })
    .map((c) =>
      typeof c === "object" && c !== null && "value" in c
        ? (c as { value: unknown }).value
        : c,
    );
}

/**
 * Minimal stand-in for the drizzle surface `recordOtpSend` touches. `counts`
 * feeds the window queries in call order (user window first, then
 * destination window).
 */
function fakeDb(counts: number[]): { db: Database; state: FakeDbState } {
  const state: FakeDbState = { ops: [], inserted: [] };
  const queue = [...counts];
  const tx = {
    execute: async (query: unknown) => {
      state.ops.push(`lock(${String(sqlParams(query)[0])})`);
      return [];
    },
    select: () => ({
      from: () => ({
        where: async () => {
          state.ops.push("count");
          return [{ count: queue.shift() ?? 0 }];
        },
      }),
    }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        state.ops.push("insert");
        state.inserted.push(row);
      },
    }),
  };
  const db = {
    transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
  } as unknown as Database;
  return { db, state };
}

describe("recordOtpSend", () => {
  beforeEach(() => {
    vi.stubEnv("OTP_LOG_HMAC_KEY", KEY);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores only the destination hash — never the plaintext", async () => {
    const { db, state } = fakeDb([0, 0]);
    const result = await recordOtpSend(db, {
      userId: USER_ID,
      destination: PHONE,
      kind: "phone",
    });

    expect(result).toEqual({ allowed: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.destinationHash).toBe(hashDestination(PHONE, "phone"));
    expect(state.inserted[0]).not.toHaveProperty("destination");
    // No fixture leakage: the row carries no fragment of the plaintext.
    expect(JSON.stringify(state.inserted)).not.toContain("3322602829");
  });

  it("takes the user lock, then the destination lock, before counting or inserting", async () => {
    const { db, state } = fakeDb([0, 0]);
    await recordOtpSend(db, { userId: USER_ID, destination: PHONE, kind: "phone" });
    // Fixed order is load-bearing: opposite orders on the same pair deadlock.
    expect(state.ops).toEqual([
      `lock(${USER_ID})`,
      `lock(${hashDestination(PHONE, "phone")})`,
      "count",
      "count",
      "insert",
    ]);
  });

  it("puts two differently-formatted spellings of one phone in one bucket", async () => {
    const first = fakeDb([0, 0]);
    const second = fakeDb([0, 0]);
    await recordOtpSend(first.db, {
      userId: USER_ID,
      destination: "+13322602829",
      kind: "phone",
    });
    await recordOtpSend(second.db, {
      userId: USER_ID,
      destination: "+1 332 260 2829",
      kind: "phone",
    });
    expect(first.state.inserted[0]!.destinationHash).toBe(
      second.state.inserted[0]!.destinationHash,
    );
  });

  it("keeps phone and email buckets for the same string separate", async () => {
    const first = fakeDb([0, 0]);
    const second = fakeDb([0, 0]);
    await recordOtpSend(first.db, { userId: USER_ID, destination: PHONE, kind: "phone" });
    await recordOtpSend(second.db, { userId: USER_ID, destination: PHONE, kind: "email" });
    expect(first.state.inserted[0]!.destinationHash).not.toBe(
      second.state.inserted[0]!.destinationHash,
    );
  });

  it("caps the user window without inserting", async () => {
    const { db, state } = fakeDb([OTP_MAX_SENDS_PER_USER]);
    const result = await recordOtpSend(db, {
      userId: USER_ID,
      destination: PHONE,
      kind: "phone",
    });
    expect(result).toEqual({ allowed: false, reason: "user_capped" });
    expect(state.inserted).toHaveLength(0);
    expect(state.ops).toEqual([
      `lock(${USER_ID})`,
      `lock(${hashDestination(PHONE, "phone")})`,
      "count",
    ]);
  });

  it("caps the destination window without inserting", async () => {
    const { db, state } = fakeDb([0, OTP_MAX_SENDS_PER_DESTINATION]);
    const result = await recordOtpSend(db, {
      userId: USER_ID,
      destination: PHONE,
      kind: "phone",
    });
    expect(result).toEqual({ allowed: false, reason: "destination_capped" });
    expect(state.inserted).toHaveLength(0);
  });

  it("fails before opening a transaction when OTP_LOG_HMAC_KEY is unset", async () => {
    vi.stubEnv("OTP_LOG_HMAC_KEY", "");
    const { db, state } = fakeDb([0, 0]);
    await expect(
      recordOtpSend(db, { userId: USER_ID, destination: PHONE, kind: "phone" }),
    ).rejects.toThrow(/OTP_LOG_HMAC_KEY/);
    expect(state.ops).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@koolee/db";

import { hashDestination } from "./hash-destination";
import { OTP_MAX_SENDS_PER_USER } from "./otp-throttle";
import { guardUpgradeOtpSend } from "./upgrade-guard";

const KEY = "k".repeat(64);
const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ANON = "00000000-0000-4000-8000-000000000002";
const PHONE = "+13322602829";

/** Flattens a drizzle sql`` template to text, params rendered as "?". */
function sqlText(query: unknown): string {
  if (typeof query !== "object" || query === null) return "";
  if ("queryChunks" in query) {
    return (query as { queryChunks: unknown[] }).queryChunks.map(sqlText).join("");
  }
  if ("encoder" in query) return "?"; // Param
  if ("value" in query) {
    const v = (query as { value: unknown }).value;
    return Array.isArray(v) ? v.join("") : "";
  }
  return "";
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

interface FakeState {
  /** Ordered ops across the WHOLE guard — proves one shared transaction. */
  ops: string[];
  transactions: number;
  inserted: Array<Record<string, unknown>>;
}

/**
 * Fake drizzle surface for the merged guard: advisory locks and the
 * `auth.users` read both arrive via `tx.execute`, told apart by their SQL
 * text. `counts` feeds the throttle's two window queries; `claims` is what
 * the reconcile read returns.
 */
function fakeDb(input: {
  counts: number[];
  claims?: Array<{ id: string; is_anonymous: boolean }>;
}): { db: Database; state: FakeState } {
  const state: FakeState = { ops: [], transactions: 0, inserted: [] };
  const queue = [...input.counts];
  const tx = {
    execute: async (query: unknown) => {
      const text = sqlText(query);
      if (text.includes("pg_advisory_xact_lock")) {
        state.ops.push(`lock(${String(sqlParams(query)[0])})`);
        return [];
      }
      if (text.includes("auth.users")) {
        state.ops.push("reconcile-read");
        return input.claims ?? [];
      }
      throw new Error(`unexpected execute: ${text}`);
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
    delete: () => ({
      where: async () => {
        state.ops.push("delete-row");
      },
    }),
  };
  const db = {
    transaction: async (cb: (t: typeof tx) => Promise<unknown>) => {
      state.transactions += 1;
      return cb(tx);
    },
  } as unknown as Database;
  return { db, state };
}

describe("guardUpgradeOtpSend", () => {
  beforeEach(() => {
    vi.stubEnv("OTP_LOG_HMAC_KEY", KEY);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs throttle and reconciliation in ONE transaction, locks first, fixed order", async () => {
    const { db, state } = fakeDb({ counts: [0, 0], claims: [] });
    const result = await guardUpgradeOtpSend(db, {
      userId: USER_ID,
      destination: PHONE,
      kind: "phone",
    });

    expect(result).toEqual({ allowed: true, conflict: false, removedAnonymousUserIds: [] });
    expect(state.transactions).toBe(1);
    expect(state.ops).toEqual([
      `lock(${USER_ID})`,
      `lock(${hashDestination(PHONE, "phone")})`,
      "count",
      "count",
      "insert",
      "reconcile-read",
    ]);
  });

  it("returns capped without reconciling or inserting", async () => {
    const { db, state } = fakeDb({ counts: [OTP_MAX_SENDS_PER_USER] });
    const result = await guardUpgradeOtpSend(db, {
      userId: USER_ID,
      destination: PHONE,
      kind: "phone",
    });

    expect(result).toEqual({
      allowed: false,
      reason: "user_capped",
      conflict: false,
      removedAnonymousUserIds: [],
    });
    expect(state.ops).not.toContain("insert");
    expect(state.ops).not.toContain("reconcile-read");
  });

  it("skips reconciliation when reconcile: false (no GoTrue auth schema)", async () => {
    const { db, state } = fakeDb({ counts: [0, 0] });
    const result = await guardUpgradeOtpSend(db, {
      userId: USER_ID,
      destination: PHONE,
      kind: "phone",
      reconcile: false,
    });

    expect(result).toEqual({ allowed: true, conflict: false, removedAnonymousUserIds: [] });
    expect(state.ops).not.toContain("reconcile-read");
    expect(state.inserted).toHaveLength(1);
  });

  it("reports a permanent claimant as a conflict AND still records the send", async () => {
    const { db, state } = fakeDb({
      counts: [0, 0],
      claims: [{ id: OTHER_ANON, is_anonymous: false }],
    });
    const result = await guardUpgradeOtpSend(db, {
      userId: USER_ID,
      destination: PHONE,
      kind: "phone",
    });

    expect(result).toEqual({ allowed: true, conflict: true, removedAnonymousUserIds: [] });
    // Probing a registered number is not a free pass around the caps
    // (acceptance test 16's ordering property, preserved by the merge).
    expect(state.inserted).toHaveLength(1);
  });

  it("removes anonymous claimants inside the same transaction, via the injected delete", async () => {
    const deleteAuthUser = vi.fn(async () => {});
    const { db, state } = fakeDb({
      counts: [0, 0],
      claims: [{ id: OTHER_ANON, is_anonymous: true }],
    });
    const result = await guardUpgradeOtpSend(db, {
      userId: USER_ID,
      destination: PHONE,
      kind: "phone",
      deleteAuthUser,
      log: () => {},
    });

    expect(result).toEqual({
      allowed: true,
      conflict: false,
      removedAnonymousUserIds: [OTHER_ANON],
    });
    expect(deleteAuthUser).toHaveBeenCalledTimes(1);
    expect(deleteAuthUser).toHaveBeenCalledWith(OTHER_ANON);
    // Draft + users row deletes happened after the reconcile read, same tx.
    expect(state.transactions).toBe(1);
    expect(state.ops.filter((op) => op === "delete-row")).toHaveLength(2);
  });
});

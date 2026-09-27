import * as SQLite from "expo-sqlite";
import {
  apiRoutes,
  positionsResponseSchema,
  POSITIONS_MAX_BATCH,
  type PositionFix,
} from "@koolee/api-contract";

import { apiFetch } from "@/lib/api";

import { positionBatchDisposition } from "./disposition";
import { positionInserts } from "./position-rows";

/**
 * The on-device queue — SQLite, WAL mode, two tables.
 *
 * WHY A DATABASE AND NOT MEMORY. Location fixes arrive in a headless task
 * with no React tree and no guarantee the app process survives between
 * batches; a queued step must survive the app being killed mid-tunnel. SQLite
 * is the one store both the task and the screens can share safely.
 *
 * POSITIONS: append every fix, send oldest-first in batches of up to 120
 * (the server's cap), keep a rolling hour (720 fixes at 5 s). A 2xx deletes
 * the batch; what a failure does is `positionBatchDisposition` — no signal, a
 * 5xx or a 401 keep it for the next flush, a 409 not_on_shift or a 400 drop
 * it (they will never succeed, and retrying them forever would block the
 * fixes behind them).
 *
 * ACTIONS: the driver's steps taken offline (phase 4 fills the writers).
 * Each row carries the `Idempotency-Key` it was minted with, so a replay whose
 * first attempt actually landed gets the stored answer back, not a refusal.
 */

export interface QueuedPosition extends PositionFix {
  id: number;
  recordedAt: string;
}

const DB_NAME = "koolee-driver.db";
const MAX_POSITIONS = 720;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function db(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const handle = await SQLite.openDatabaseAsync(DB_NAME);
      // busy_timeout: on Android a location batch that arrives while the app
      // is not running is handled in a HEADLESS JS context with its own
      // connection to this file. Two connections writing at once is ordinary
      // there, and without a timeout the loser fails at once with
      // SQLITE_BUSY instead of waiting a few milliseconds for the lock.
      await handle.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS position_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          recorded_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS action_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          idempotency_key TEXT NOT NULL UNIQUE,
          method TEXT NOT NULL,
          path TEXT NOT NULL,
          body TEXT,
          label TEXT NOT NULL,
          created_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT
        );
      `);
      return handle;
    })();
  }
  return dbPromise;
}

/**
 * Appends a batch. NO BEGIN/COMMIT, on purpose: expo-sqlite's
 * `withTransactionAsync` is not exclusive, and two batches landing together
 * (Android hands the task a backlog in quick succession; the foreground
 * start records a fix of its own) interleaved on the one connection — the
 * second BEGIN failed, its ROLLBACK undid the FIRST batch's transaction, and
 * the first then died with "cannot rollback - no transaction is active",
 * its fixes gone. Seen on the emulator. Each INSERT is one statement and
 * atomic on its own; the trim is a separate statement, and a trim that lands
 * late only means the queue holds a few rows past the cap until the next.
 */
export async function enqueuePositions(fixes: readonly PositionFix[]): Promise<void> {
  if (fixes.length === 0) return;
  const handle = await db();
  for (const { sql, params } of positionInserts(fixes)) {
    await handle.runAsync(sql, params);
  }
  // Rolling window: drop the oldest past the cap. An hour of backlog is
  // plenty of evidence; beyond that the pin is what matters, and it only
  // ever shows the newest fix anyway.
  await handle.runAsync(
    `DELETE FROM position_queue WHERE id <= (
       SELECT id FROM position_queue ORDER BY id DESC LIMIT 1 OFFSET ?
     )`,
    MAX_POSITIONS,
  );
}

export async function queuedPositionCount(): Promise<number> {
  const handle = await db();
  const row = await handle.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM position_queue",
  );
  return row?.n ?? 0;
}

export interface FlushResult {
  sent: number;
  dropped: number;
  /** True when a batch was kept for later (offline or server failure). */
  deferred: boolean;
}

let flushing: Promise<FlushResult> | null = null;

/**
 * Sends everything queued, oldest first, one batch per request. Serialised:
 * the headless task and the foreground pinger both call this, and two
 * flushes racing would send the same batch twice (harmless — the server keeps
 * the newest — but wasteful at 5 s cadence).
 */
export function flushPositions(): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = doFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function doFlush(): Promise<FlushResult> {
  const handle = await db();
  const result: FlushResult = { sent: 0, dropped: 0, deferred: false };
  for (;;) {
    const rows = await handle.getAllAsync<{
      id: number;
      lat: number;
      lng: number;
      recorded_at: string;
    }>(
      "SELECT id, lat, lng, recorded_at FROM position_queue ORDER BY id LIMIT ?",
      POSITIONS_MAX_BATCH,
    );
    if (rows.length === 0) return result;
    const last = rows[rows.length - 1]!;
    try {
      await apiFetch(positionsResponseSchema, apiRoutes.positions(), {
        method: "POST",
        body: {
          fixes: rows.map((r) => ({ lat: r.lat, lng: r.lng, recordedAt: r.recorded_at })),
        },
      });
      await handle.runAsync("DELETE FROM position_queue WHERE id <= ?", last.id);
      result.sent += rows.length;
    } catch (error) {
      if (positionBatchDisposition(error) === "keep") {
        result.deferred = true;
        return result;
      }
      // Off shift or a fix the server refuses: it will not get better by
      // waiting, and holding it would block every fix behind it.
      await handle.runAsync("DELETE FROM position_queue WHERE id <= ?", last.id);
      result.dropped += rows.length;
    }
  }
}

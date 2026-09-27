import { z } from "zod";
import { getNetworkStateAsync } from "expo-network";
import type { ImageMimeType } from "@koolee/api-contract";

import { ApiRequestError, apiFetch, NetworkError } from "../lib/api";
import { newId } from "../lib/ids";
import { PhotoError, uploadPhoto, type UploadBucket } from "../lib/photos";
import { db } from "../location/queue";

/**
 * The offline ACTION queue — the driver's steps, taken without a signal.
 *
 * A step is a POST with a device-minted `Idempotency-Key`. `runStep` tries it
 * now; when there is no connection it goes into `action_queue` and
 * `replayActions` sends it later, oldest first, one at a time, with the SAME
 * key — so a first attempt that actually landed (the request got through, the
 * answer did not) gets the stored answer back rather than a refusal.
 *
 * DISPOSITION is the positions queue's rule, with two named exceptions. A 2xx
 * or any 4xx deletes the row: a seal already in use, a booking no longer
 * actionable, a body the server will not take — none of these get better by
 * waiting, and holding one would block every step behind it. Its message is
 * kept in `last_error` and handed to `onActionFailed`, because a driver who
 * sealed a bag in a basement deserves to hear the server said no. The
 * exceptions: a 401 means the SESSION lapsed, not the step, and a 409
 * `idempotency_in_progress` means the first attempt is still running — both
 * will succeed shortly, so both keep the row. No network or a 5xx keeps the
 * row and stops the replay, because the next one will fail the same way.
 *
 * ONE PHOTO PER STEP. Capture-passport and seal-bag carry an image that has
 * to reach Storage before the POST that names its path. Queued, the local
 * file URI rides along and the upload happens at replay time — before the
 * POST, in the same turn.
 */

export interface QueuedPhoto {
  bucket: UploadBucket;
  path: string;
  uri: string;
  contentType: ImageMimeType;
}

export interface EnqueueActionInput {
  /** What the driver did, in their words — "Seal bag 2". Shown when it fails. */
  label: string;
  method: "POST" | "DELETE";
  path: string;
  body?: unknown;
  idempotencyKey: string;
  photo?: QueuedPhoto;
}

export interface ActionFailure {
  id: number;
  label: string;
  /** The server's sentence, or the photo's. Safe to show verbatim. */
  message: string;
  status: number | null;
}

export interface ReplayResult {
  replayed: number;
  failed: number;
  /** Rows still waiting: offline, a 5xx, or a lapsed session. */
  remaining: number;
}

export interface ReplayOptions {
  onActionFailed?: (failure: ActionFailure) => void;
}

interface ActionRow {
  id: number;
  idempotency_key: string;
  method: string;
  path: string;
  body: string | null;
  label: string;
  attempts: number;
  photo: string | null;
}

/** Whatever the server answered. The refetch after replay is the real read. */
const anyResponse = z.unknown();

/*
 * `action_queue` was created in phase 3 without a photo column, and the
 * schema lives in `location/queue.ts`, which the location task also opens.
 * Adding the column here on first use keeps this module the only one that
 * knows a step can carry a photo; SQLite's ADD COLUMN is a metadata write.
 */
let schemaReady: Promise<void> | null = null;

async function ready() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const handle = await db();
      const columns = await handle.getAllAsync<{ name: string }>(
        "PRAGMA table_info(action_queue)",
      );
      if (!columns.some((c) => c.name === "photo")) {
        await handle.execAsync("ALTER TABLE action_queue ADD COLUMN photo TEXT");
      }
    })();
    // A rejected promise must not be cached: one transient open failure would
    // otherwise refuse every enqueue and replay until the app is killed.
    schemaReady.catch(() => {
      schemaReady = null;
    });
  }
  await schemaReady;
  return db();
}

const listeners = new Set<(count: number) => void>();

/** Notifies on every enqueue and after every replay, with the new count. */
export function onQueueChange(listener: (count: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function notify() {
  if (listeners.size === 0) return;
  const count = await queuedActionCount();
  for (const listener of listeners) listener(count);
}

export async function enqueueAction(input: EnqueueActionInput): Promise<number> {
  const handle = await ready();
  const result = await handle.runAsync(
    `INSERT INTO action_queue (idempotency_key, method, path, body, label, created_at, photo)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.idempotencyKey,
    input.method,
    input.path,
    input.body === undefined ? null : JSON.stringify(input.body),
    input.label,
    new Date().toISOString(),
    input.photo ? JSON.stringify(input.photo) : null,
  );
  await notify();
  return result.lastInsertRowId;
}

export async function queuedActionCount(): Promise<number> {
  const handle = await ready();
  const row = await handle.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM action_queue",
  );
  return row?.n ?? 0;
}

let replaying: Promise<ReplayResult> | null = null;

/**
 * Sends everything queued, in order. Serialised like `flushPositions`: the
 * reconnect listener and the foreground listener fire together when the app
 * wakes with signal, and two replays would race the same first row.
 */
export function replayActions(options: ReplayOptions = {}): Promise<ReplayResult> {
  if (replaying) return replaying;
  replaying = doReplay(options).finally(() => {
    replaying = null;
  });
  return replaying;
}

type Disposition =
  { kind: "drop"; message: string; status: number | null } | { kind: "keep" };

function classify(error: unknown): Disposition {
  if (error instanceof NetworkError) return { kind: "keep" };
  if (error instanceof ApiRequestError) {
    if (error.status >= 500) return { kind: "keep" };
    if (error.status === 401) return { kind: "keep" };
    if (error.code === "idempotency_in_progress") return { kind: "keep" };
    return { kind: "drop", message: error.message, status: error.status };
  }
  if (error instanceof PhotoError)
    return { kind: "drop", message: error.message, status: null };
  // Something this module did not anticipate — a bug, most likely. Keeping
  // the row costs a retry; dropping it costs the driver's step.
  return { kind: "keep" };
}

function parsePhoto(raw: string | null): QueuedPhoto | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as QueuedPhoto;
  } catch {
    return null;
  }
}

async function doReplay(options: ReplayOptions): Promise<ReplayResult> {
  const handle = await ready();
  const result: ReplayResult = { replayed: 0, failed: 0, remaining: 0 };
  try {
    for (;;) {
      const row = await handle.getFirstAsync<ActionRow>(
        `SELECT id, idempotency_key, method, path, body, label, attempts, photo
         FROM action_queue ORDER BY id LIMIT 1`,
      );
      if (!row) return result;

      try {
        const photo = parsePhoto(row.photo);
        if (photo) {
          await uploadPhoto(photo);
          // The object is in the bucket; a later attempt must not need the
          // local file, which the OS may have cleared from the cache by then.
          await handle.runAsync(
            "UPDATE action_queue SET photo = NULL WHERE id = ?",
            row.id,
          );
        }
        await apiFetch(anyResponse, row.path, {
          method: row.method === "DELETE" ? "DELETE" : "POST",
          body: row.body === null ? {} : (JSON.parse(row.body) as unknown),
          idempotencyKey: row.idempotency_key,
        });
        await handle.runAsync("DELETE FROM action_queue WHERE id = ?", row.id);
        result.replayed += 1;
      } catch (error) {
        const disposition = classify(error);
        if (disposition.kind === "keep") {
          await handle.runAsync(
            "UPDATE action_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?",
            error instanceof Error ? error.message : String(error),
            row.id,
          );
          return result;
        }
        await handle.runAsync("DELETE FROM action_queue WHERE id = ?", row.id);
        result.failed += 1;
        options.onActionFailed?.({
          id: row.id,
          label: row.label,
          message: disposition.message,
          status: disposition.status,
        });
      }
    }
  } finally {
    result.remaining = await queuedActionCount();
    await notify();
  }
}

export interface RunStepInput {
  label: string;
  path: string;
  body?: unknown;
  method?: "POST" | "DELETE";
  photo?: QueuedPhoto;
}

export type RunStepResult = { queued: true } | { queued: false };

/**
 * A 401 with no signal is not a refusal. `apiFetch` throws one BEFORE any
 * request when supabase-js cannot hand back a token — and it cannot when the
 * stored one expired while the phone was out of coverage and the refresh
 * had nowhere to go. The step is sound; the session will come back with the
 * signal (`replayActions` keeps 401 rows for the same reason). Online, a
 * 401 is the server's answer and is rethrown like any other refusal.
 */
async function deviceIsOffline(): Promise<boolean> {
  try {
    const { isConnected, isInternetReachable } = await getNetworkStateAsync();
    return isConnected === false || isInternetReachable === false;
  } catch {
    return false;
  }
}

async function shouldQueue(error: unknown): Promise<boolean> {
  if (error instanceof NetworkError) return true;
  if (error instanceof ApiRequestError && error.status === 401) return deviceIsOffline();
  return false;
}

/**
 * The ONE function step screens call.
 *
 * Tries the request now. Without a connection the step is queued and the
 * screen hears `{ queued: true }`, so it can say the step is waiting rather
 * than that it happened. A server refusal (`ApiRequestError`) is rethrown for
 * the screen to show verbatim — it is the answer, not a transport problem.
 * `PhotoError` is rethrown too: the photo is the problem, and queueing it
 * would only fail the same way later.
 *
 * The idempotency key is minted here, before the first attempt, and the same
 * key goes into the queue — that is the whole point of having one.
 */
export async function runStep(input: RunStepInput): Promise<RunStepResult> {
  const idempotencyKey = newId();
  const method = input.method ?? "POST";
  let photoUploaded = false;

  try {
    if (input.photo) {
      await uploadPhoto(input.photo);
      photoUploaded = true;
    }
    await apiFetch(anyResponse, input.path, {
      method,
      body: input.body ?? {},
      idempotencyKey,
    });
    return { queued: false };
  } catch (error) {
    if (!(await shouldQueue(error))) throw error;
    await enqueueAction({
      label: input.label,
      method,
      path: input.path,
      body: input.body ?? {},
      idempotencyKey,
      ...(input.photo && !photoUploaded ? { photo: input.photo } : {}),
    });
    return { queued: true };
  }
}

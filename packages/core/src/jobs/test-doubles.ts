import {
  airlineCutoffs,
  airports,
  bags,
  bookings,
  pickupTasks,
  pushSubscriptions,
  staffMembers,
  users,
  verificationTasks,
  waitlistSignups,
  addresses,
} from "@koolee/db";

import type { KooleeInngest } from "./client";

/**
 * Fakes for unit-testing the Inngest functions.
 *
 * `createKooleeFunctions` takes its client as an argument, which is what makes
 * this possible at all: hand it a recorder instead of a real client and the
 * handlers become plain async functions you can call. No Inngest dev server,
 * no database, no network — which is the only way the reminder's `sleepUntil`
 * target and the `REMINDER_WORTHY` guard are testable at all, since a real run
 * would suspend for hours.
 *
 * Not exported from the package barrel: test scaffolding, deliberately kept
 * out of the public surface.
 */

/* ------------------------------------------------------------------ */
/* Inngest client                                                      */
/* ------------------------------------------------------------------ */

export interface RecordedFunction {
  id: string;
  name?: string;
  /** Cron expressions this function is triggered by, in declaration order. */
  crons: string[];
  /** Event names this function is triggered by. */
  events: string[];
  handler: (ctx: FakeContext) => Promise<unknown>;
}

/** Stands in for `KooleeInngest`, capturing handlers instead of registering them. */
export class RecordingInngest {
  readonly functions: RecordedFunction[] = [];

  createFunction(
    config: { id: string; name?: string; triggers?: unknown[] },
    handler: (ctx: FakeContext) => Promise<unknown>,
  ): RecordedFunction {
    const triggers = (config.triggers ?? []) as {
      cron?: string;
      event?: string;
      name?: string;
    }[];
    const recorded: RecordedFunction = {
      id: config.id,
      ...(config.name === undefined ? {} : { name: config.name }),
      crons: triggers.flatMap((t) => (typeof t.cron === "string" ? [t.cron] : [])),
      events: triggers.flatMap((t) => {
        const name = t.event ?? t.name;
        return typeof name === "string" ? [name] : [];
      }),
      handler,
    };
    this.functions.push(recorded);
    return recorded;
  }

  /** The client the factory is given. The cast is the point of this class. */
  asClient(): KooleeInngest {
    return this as unknown as KooleeInngest;
  }
}

/* ------------------------------------------------------------------ */
/* step + logger                                                       */
/* ------------------------------------------------------------------ */

export interface FakeContext {
  event: { data: Record<string, unknown> };
  step: FakeStep;
  logger: {
    info: (m: string) => void;
    warn: (m: string) => void;
    error: (m: string) => void;
  };
}

/**
 * Runs every step inline.
 *
 * `sleepUntil` records its target and returns immediately — the whole reason
 * this fake exists. A durable sleep is correct in production and untestable
 * in a unit test; recording the instant lets us assert the SCHEDULING is right
 * without waiting for it.
 */
export class FakeStep {
  readonly ran: string[] = [];
  readonly slept: { id: string; at: Date }[] = [];

  async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
    this.ran.push(id);
    return fn();
  }

  async sleepUntil(id: string, at: Date): Promise<void> {
    this.slept.push({ id, at: new Date(at) });
  }
}

/** Inngest's logger surface, recording instead of printing. */
export function fakeLogger(): {
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
  lines: string[];
} {
  const lines: string[] = [];
  return {
    info: (m: string) => void lines.push(`info: ${m}`),
    warn: (m: string) => void lines.push(`warn: ${m}`),
    error: (m: string) => void lines.push(`error: ${m}`),
    lines,
  };
}

/* ------------------------------------------------------------------ */
/* database                                                            */
/* ------------------------------------------------------------------ */

export interface FakeTables {
  bookings?: Record<string, unknown>[];
  bags?: Record<string, unknown>[];
  users?: Record<string, unknown>[];
  addresses?: Record<string, unknown>[];
  airports?: Record<string, unknown>[];
  airlineCutoffs?: Record<string, unknown>[];
  verificationTasks?: Record<string, unknown>[];
  pickupTasks?: Record<string, unknown>[];
  waitlistSignups?: Record<string, unknown>[];
  /**
   * Push audiences. Left EMPTY by every test in this tier on purpose: the
   * fake ignores `where` clauses, so an audience query here would return
   * every row and prove the opposite of what it looked like it proved. Who
   * receives what is tested against a real database in
   * `push-moments.integration.test.ts`; this tier only needs the push steps
   * to run and find nobody.
   */
  pushSubscriptions?: Record<string, unknown>[];
  staffMembers?: Record<string, unknown>[];
}

/**
 * Just enough Drizzle to run these six handlers.
 *
 * `where` clauses are IGNORED — every table holds the rows a test seeded and
 * `findFirst` returns the first of them. That is honest for what is being
 * tested here (send-or-skip decisions, sleep targets, error handling), and the
 * query predicates themselves are already covered by the integration suites
 * against real Postgres. A fake that pretended to evaluate `eq()` would be a
 * second, worse query engine.
 */
export function fakeDb(tables: FakeTables) {
  const rowsFor = (table: unknown): Record<string, unknown>[] => {
    if (table === bookings) return tables.bookings ?? [];
    if (table === bags) return tables.bags ?? [];
    if (table === users) return tables.users ?? [];
    if (table === addresses) return tables.addresses ?? [];
    if (table === airports) return tables.airports ?? [];
    if (table === airlineCutoffs) return tables.airlineCutoffs ?? [];
    if (table === verificationTasks) return tables.verificationTasks ?? [];
    if (table === pickupTasks) return tables.pickupTasks ?? [];
    if (table === pushSubscriptions) return tables.pushSubscriptions ?? [];
    if (table === staffMembers) return tables.staffMembers ?? [];
    if (table === waitlistSignups) return tables.waitlistSignups ?? [];
    throw new Error("fakeDb: unseeded table reached — add it to FakeTables.");
  };

  /** Thenable so `await db.select().from(t).where(x)` resolves to the rows. */
  const chain = (rows: Record<string, unknown>[]) => {
    const self = {
      where: () => self,
      limit: () => self,
      orderBy: () => self,
      innerJoin: () => self,
      then: <T>(
        onFulfilled?: ((value: Record<string, unknown>[]) => T) | null,
        onRejected?: ((reason: unknown) => T) | null,
      ) => Promise.resolve(rows).then(onFulfilled, onRejected),
    };
    return self;
  };

  const first = (key: keyof FakeTables) => ({
    findFirst: async () => (tables[key] ?? [])[0],
    findMany: async () => tables[key] ?? [],
  });

  const updates: { table: unknown; values: Record<string, unknown> }[] = [];

  return {
    updates,
    db: {
      query: {
        bookings: first("bookings"),
        users: first("users"),
        addresses: first("addresses"),
        airports: first("airports"),
        verificationTasks: first("verificationTasks"),
        pickupTasks: first("pickupTasks"),
      },
      select: () => ({ from: (table: unknown) => chain(rowsFor(table)) }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          updates.push({ table, values });
          return { where: async () => undefined };
        },
      }),
    } as never,
  };
}

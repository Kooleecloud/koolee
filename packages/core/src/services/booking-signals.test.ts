import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The signal mechanism is a MIGRATION, so this is what tests it.
 *
 * `touchBookingSignal` is four lines of upsert; the thing that actually
 * carries the guarantee — "every custody event rings the doorbell, including
 * from a service written next year" — is a trigger, one RLS policy, and a
 * SECURITY DEFINER function in `0030_booking_signals.sql`. Asserting those
 * against the SQL is the same move `buckets.test.ts` makes for bucket limits,
 * and for the same reason: the alternative is prose that goes stale.
 *
 * The behavioural half (a transition touches the row exactly once, an
 * unrelated booking's row does not move) is in
 * `booking-signals.integration.test.ts`, which needs a database.
 */

const MIGRATION = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../db/drizzle/0030_booking_signals.sql",
  ),
  "utf8",
);

describe("0030 — booking_signals", () => {
  it("creates the table with exactly three columns", () => {
    // Three, on purpose. Every column here is visible to a browser through
    // RLS, so the surface is the security argument: what leaks in the worst
    // case is "a booking changed at an instant", and nothing else.
    expect(MIGRATION).toMatch(/CREATE TABLE "booking_signals"/);
    expect(MIGRATION).toMatch(/"booking_id" uuid PRIMARY KEY NOT NULL/);
    expect(MIGRATION).toMatch(/"updated_at" timestamp with time zone/);
    expect(MIGRATION).toMatch(/"touched_by" uuid/);
  });

  it("cascades from bookings, so a deleted booking takes its signal", () => {
    expect(MIGRATION).toMatch(
      /booking_signals_booking_id_bookings_id_fk[\s\S]*?ON DELETE cascade/,
    );
  });

  it("backfills a row for every existing booking", () => {
    // Otherwise a page opened against a pre-0030 booking watches a row that
    // does not exist yet, and sees an INSERT rather than an UPDATE first.
    expect(MIGRATION).toMatch(
      /INSERT INTO public\.booking_signals[\s\S]*?FROM public\.bookings/,
    );
    expect(MIGRATION).toMatch(/ON CONFLICT \(booking_id\) DO NOTHING/);
  });

  /* ---------------------------------------------------------------- */
  /* The trigger — the whole "by construction" claim                   */
  /* ---------------------------------------------------------------- */

  it("touches the signal from an AFTER INSERT trigger on custody_events", () => {
    // This is the claim that matters: ~20 services append custody events and
    // none of them knows this table exists. A trigger is what makes the 21st
    // correct without being told.
    expect(MIGRATION).toMatch(
      /CREATE TRIGGER custody_events_touch_signal\s+AFTER INSERT ON public\.custody_events\s+FOR EACH ROW EXECUTE FUNCTION public\.touch_booking_signal\(\)/,
    );
  });

  it("upserts rather than inserts, so the row is overwritten in place", () => {
    expect(MIGRATION).toMatch(
      /INSERT INTO public\.booking_signals \(booking_id, updated_at, touched_by\)[\s\S]*?ON CONFLICT \(booking_id\) DO UPDATE/,
    );
  });

  it("does not add UPDATE or DELETE triggers to custody_events", () => {
    // custody_events is append-only (0001). A signal trigger that fired on
    // anything but INSERT would be dead code advertising a mutation path.
    const signalTriggers = MIGRATION.match(/CREATE TRIGGER custody_events_touch_signal[\s\S]*?;/g);
    expect(signalTriggers).toHaveLength(1);
    expect(signalTriggers![0]).not.toMatch(/BEFORE|UPDATE|DELETE|TRUNCATE/);
  });

  /* ---------------------------------------------------------------- */
  /* The policy                                                        */
  /* ---------------------------------------------------------------- */

  it("carries exactly one policy, and it is SELECT only", () => {
    // Every write reaches this table over the direct/service-role connection,
    // which bypasses RLS. An INSERT or UPDATE policy would be a client write
    // path nobody uses and everybody would have to reason about.
    const policies = MIGRATION.match(/CREATE POLICY "[^"]+"/g) ?? [];
    expect(policies).toHaveLength(1);
    expect(policies[0]).toBe('CREATE POLICY "booking_signals_select_watchable"');
    expect(MIGRATION).toMatch(/FOR SELECT\s+TO authenticated/);
  });

  it("routes the staff check through a SECURITY DEFINER function", () => {
    // The lesson from 0008->0009 and 0022->0023: RLS is on for every table in
    // public (0016) and the task tables have no policies, so an inline
    // EXISTS on verification_tasks would evaluate as `authenticated`, return
    // nothing, and the staff half would silently never match.
    expect(MIGRATION).toMatch(
      /CREATE OR REPLACE FUNCTION public\.can_watch_booking\(uid uuid, booking uuid\)[\s\S]*?SECURITY DEFINER/,
    );
    expect(MIGRATION).toMatch(/USING \(public\.can_watch_booking\(auth\.uid\(\), booking_id\)\)/);
  });

  it("admits the owning customer and an assigned staff member, nobody else", () => {
    const fn = MIGRATION.slice(
      MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.can_watch_booking"),
      MIGRATION.indexOf("REVOKE ALL ON FUNCTION public.can_watch_booking"),
    );
    expect(fn).toMatch(/b\.user_id = uid/);
    expect(fn).toMatch(/public\.is_active_staff\(uid\)/);
    expect(fn).toMatch(/verification_tasks vt[\s\S]*?vt\.assignee_user_id = uid/);
    expect(fn).toMatch(/pickup_tasks pt[\s\S]*?pt\.assignee_user_id = uid/);
    // A null uid is an unauthenticated session; it must never match.
    expect(fn).toMatch(/uid IS NOT NULL/);
  });

  it("keeps the function off `public` and grants only authenticated", () => {
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.can_watch_booking\(uuid, uuid\) FROM public/,
    );
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.can_watch_booking\(uuid, uuid\) TO authenticated/,
    );
  });

  /* ---------------------------------------------------------------- */
  /* Realtime plumbing                                                 */
  /* ---------------------------------------------------------------- */

  it("sets REPLICA IDENTITY FULL and joins the supabase_realtime publication", () => {
    expect(MIGRATION).toMatch(
      /ALTER TABLE public\.booking_signals REPLICA IDENTITY FULL/,
    );
    expect(MIGRATION).toMatch(
      /ALTER PUBLICATION supabase_realtime ADD TABLE public\.booking_signals/,
    );
  });

  it("adds no domain table to the publication", () => {
    // The standing rule: realtime and RLS stay off the real tables. Only the
    // doorbell is published here.
    const published = [...MIGRATION.matchAll(/ADD TABLE public\.(\w+)/g)].map((m) => m[1]);
    expect(published).toEqual(["booking_signals"]);
  });

  it("guards every Supabase-only block so plain Postgres still migrates", () => {
    // docker-compose and CI run Postgres 16 with no auth schema and no
    // publication. An ungated CREATE POLICY makes this migration unrunnable
    // there — which would take the whole local stack with it.
    expect(MIGRATION).toMatch(/rolname = 'authenticated'/);
    expect(MIGRATION).toMatch(/to_regprocedure\('auth\.uid\(\)'\) IS NULL/);
    expect(MIGRATION).toMatch(/pg_publication WHERE pubname = 'supabase_realtime'/);
  });
});

import "server-only";

import { cache } from "react";
import { getOpsDashboard, type OpsDashboard } from "@koolee/core";

import { OPS_CONSOLE_TZ } from "@/lib/airport-tz";
import { tryGetCore } from "@/lib/core";

/**
 * Today's ops numbers, read once per request.
 *
 * Two surfaces want them now: the Overview page, which has always shown them,
 * and the rail's count badges, which put "2 need an agent" and "3 in
 * exception" in front of an operator wherever they are instead of only on the
 * landing page. `cache()` is what makes that second surface free — the layout
 * and the page share one query rather than each issuing their own.
 *
 * Returns null rather than throwing when the database is absent or the query
 * fails: an unreachable database should cost the badges, not the console.
 * Callers render their own empty or `DatabaseNotConfigured` state.
 */
export const getConsoleDashboard = cache(async (): Promise<OpsDashboard | null> => {
  const core = tryGetCore();
  if (!core) return null;
  return getOpsDashboard(core.db, OPS_CONSOLE_TZ).catch(() => null);
});

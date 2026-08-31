/**
 * Where `pnpm seed` is allowed to point.
 *
 * The seed is NOT additive. It converges: all 128 `airline_cutoffs` rows go
 * back to the placeholder 45/60 minutes with their `source` overwritten
 * ("seed: placeholder — VERIFY …"), and the active `pricing_rules` row is
 * rewritten field by field to the hardcoded `launch-v1` numbers. Both of
 * those are exactly the values ops replaces by hand before real sales — the
 * cutoff matrix is the single most safety-critical data in the database,
 * because every sellable pickup window is derived from it.
 *
 * So a routine `pnpm seed` against a launched project silently undoes the one
 * piece of launch work that cannot be re-derived from the repository, and two
 * docs used to tell you to run exactly that ("Idempotent, as always"). It IS
 * idempotent — with respect to itself, not with respect to a human's work.
 *
 * This guard is the same shape as 0029's drop guard: refuse, say why, and
 * make the operator state the intent out loud. `SEED_ALLOW_HOSTED=1` is the
 * escape hatch for the one legitimate case — standing up a brand-new hosted
 * project on day one, before anybody has verified anything.
 */

/** The env var that lets a seed run against a non-local database. */
export const SEED_ALLOW_HOSTED_ENV = "SEED_ALLOW_HOSTED";

/**
 * Hosts that mean "a database on this machine, or the docker network of this
 * machine": the Supabase CLI stack (127.0.0.1:54322), the compose service in
 * docker-compose.yml (`postgres`, container `koolee-postgres`, published on
 * 5433), and the address a container uses to reach its host.
 *
 * Deliberately a fixed list rather than a pattern. A pattern that admits
 * anything shaped like a private address would also admit a bastion or a
 * tunnel to production, which is precisely the case this exists to stop.
 */
const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "::1",
  "localhost",
  "host.docker.internal",
  "postgres",
  "koolee-postgres",
]);

/** True when `hostname` is one of the local targets above. */
export function isLocalDatabaseHost(hostname: string): boolean {
  // `new URL(…).hostname` keeps IPv6 literals in brackets — `[::1]`.
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase().replace(/^\[|\]$/g, ""));
}

/** Thrown instead of seeding. Carries the resolved host so the message can name it. */
export class HostedSeedRefusedError extends Error {
  readonly host: string;

  constructor(host: string) {
    super(
      [
        `Seed REFUSED: '${host}' is not a local database.`,
        "",
        "`pnpm seed` is not additive. It resets all 128 airline_cutoffs rows to the",
        "placeholder 45/60 minutes (overwriting `source`), and rewrites the active",
        "pricing rule to the hardcoded launch-v1 numbers. On a project where ops has",
        "verified real cutoffs or set real prices, that work is gone with no error and",
        "no diff — and the cutoff matrix is what decides whether a pickup can make its",
        "flight.",
        "",
        "Launch data belongs in the admin console, not in the seed:",
        "  cutoffs   /cutoffs      pricing   /pricing",
        "  agreement /agreements   fleet     /trucks · /shifts · /zones",
        "",
        `If this really is a brand-new project with nothing to lose, re-run with ${SEED_ALLOW_HOSTED_ENV}=1.`,
      ].join("\n"),
    );
    this.name = "HostedSeedRefusedError";
    this.host = host;
  }
}

export type SeedTargetVerdict =
  { kind: "local"; host: string } | { kind: "hosted-allowed"; host: string };

/**
 * Decide whether a seed may run against `connectionString`.
 *
 * Throws `HostedSeedRefusedError` for a non-local host without the override.
 * A connection string that will not parse is treated as non-local: an
 * unparseable target is an unknown target, and unknown is not local.
 */
export function assertSeedTargetAllowed(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): SeedTargetVerdict {
  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    host = "<unparseable connection string>";
  }

  if (isLocalDatabaseHost(host)) return { kind: "local", host };
  // Any non-empty value except "0"/"false" — an operator typing
  // `SEED_ALLOW_HOSTED=yes` has stated the intent as clearly as `=1`.
  const raw = env[SEED_ALLOW_HOSTED_ENV]?.trim().toLowerCase();
  if (raw && raw !== "0" && raw !== "false") return { kind: "hosted-allowed", host };

  throw new HostedSeedRefusedError(host);
}

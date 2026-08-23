import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import * as schema from "./schema";

export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema>;

export interface DbConfig {
  /**
   * Postgres connection string.
   *
   * Runtime: the Supabase Supavisor pooler in **transaction mode**, port 6543.
   * Defaults to `process.env.DATABASE_URL`.
   */
  url?: string;
  /** Max sockets in this process's pool. Keep small on serverless. */
  max?: number;
  /** Seconds an idle socket is kept before being closed. */
  idleTimeout?: number;
  /** Seconds to wait for a connection before giving up. */
  connectTimeout?: number;
  /** Log every statement. Off by default. */
  debug?: boolean;
}

export class MissingDatabaseUrlError extends Error {
  constructor(varName: string) {
    super(
      `${varName} is not set. Copy .env.example to .env.local and point it at ` +
        `your Postgres instance (\`docker compose up -d\` gives you a local one).`,
    );
    this.name = "MissingDatabaseUrlError";
  }
}

/**
 * Runtime connection factory.
 *
 * `prepare: false` is REQUIRED. Supavisor transaction mode hands a different
 * backend connection to each transaction, so server-side prepared statements
 * from a previous checkout will not exist. Leaving prepare on produces
 * intermittent "prepared statement does not exist" errors under load — a class
 * of bug that will not reproduce locally against a direct connection.
 *
 * Importing this module never connects; the socket opens on first query.
 */
export function createDb(config: DbConfig = {}): Database {
  const url = config.url ?? process.env.DATABASE_URL;
  if (!url) throw new MissingDatabaseUrlError("DATABASE_URL");

  const client = createSqlClient(url, config);
  return drizzle(client, { schema, logger: config.debug ?? false });
}

/** The raw `postgres` client, if you need `sql` template access. */
export function createSqlClient(url: string, config: DbConfig = {}): Sql {
  return postgres(url, {
    prepare: false,
    max: config.max ?? 10,
    idle_timeout: config.idleTimeout ?? 20,
    connect_timeout: config.connectTimeout ?? 10,
  });
}

/**
 * Process-wide singleton.
 *
 * Next.js dev reloads modules on every edit; without this, each reload would
 * open a fresh pool and exhaust Supavisor's connection budget within a few
 * minutes of editing.
 */
const globalForDb = globalThis as unknown as { __kooleeDb?: Database };

export function getDb(config: DbConfig = {}): Database {
  if (!globalForDb.__kooleeDb) {
    globalForDb.__kooleeDb = createDb(config);
  }
  return globalForDb.__kooleeDb;
}

/**
 * Non-throwing variant for render paths that should degrade to an empty state
 * rather than 500 when the database is not configured.
 */
export function tryGetDb(config: DbConfig = {}): Database | null {
  try {
    return getDb(config);
  } catch {
    return null;
  }
}

/**
 * Local Postgres (Supabase CLI, docker compose) speaks plaintext and rejects a
 * forced TLS handshake; everything else is assumed to be cloud and gets TLS.
 */
function isLocalHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

/**
 * Migration connection factory — the **direct** connection on port 5432, not
 * the pooler. DDL and advisory locks need a stable backend, which transaction
 * pooling cannot provide.
 */
export function createMigrationClient(url?: string): Sql {
  const resolved = url ?? process.env.DIRECT_DATABASE_URL;
  if (!resolved) throw new MissingDatabaseUrlError("DIRECT_DATABASE_URL");

  return postgres(resolved, {
    max: 1,
    prepare: false,
    onnotice: () => {},
    ssl: isLocalHost(resolved) ? false : "require",
  });
}

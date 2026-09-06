import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ALL_BUCKETS, BUCKETS, extensionForUpload, type BucketSpec } from "./buckets";

/**
 * The migrations and `BUCKETS` must not drift.
 *
 * `storage.buckets` is configured by SQL, but every app reads its limits from
 * this package. Nothing but this test stops someone raising `maxUploadBytes`
 * here, shipping it, and leaving Storage rejecting at the old ceiling — which
 * surfaces to a customer as "something went wrong" rather than as the size
 * message the app would have shown. So the SQL is parsed and compared, rather
 * than trusted.
 *
 * Parsing SQL with a regex is ordinarily a bad idea. It is the right one here:
 * the alternative is generating the migration, and a generated migration is a
 * file drizzle's journal has already hashed — it cannot be regenerated later
 * without rewriting history. A test that reads the shipped file has neither
 * problem.
 */

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, "../../../db/drizzle");

interface SqlBucketRow {
  id: string;
  isPublic: boolean;
  fileSizeLimit: number;
  mimeTypes: string[];
}

/** Every `(id, name, public, file_size_limit, ARRAY[...])` tuple in a migration. */
function parseBucketRows(fileName: string): SqlBucketRow[] {
  const sql = readFileSync(join(drizzleDir, fileName), "utf8");
  const pattern =
    /\(\s*'([a-z0-9-]+)'\s*,\s*'[a-z0-9-]+'\s*,\s*(true|false)\s*,\s*(\d+)\s*,\s*ARRAY\[([^\]]+)\]\s*\)/g;

  return [...sql.matchAll(pattern)].map((match) => ({
    id: match[1]!,
    isPublic: match[2] === "true",
    fileSizeLimit: Number(match[3]),
    mimeTypes: [...match[4]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!),
  }));
}

const sqlRows = new Map(
  [
    ...parseBucketRows("0026_bucket_config.sql"),
    ...parseBucketRows("0027_avatars_bucket.sql"),
  ].map((row) => [row.id, row] as const),
);

describe("bucket specs", () => {
  it("parses a row out of the migrations for every declared bucket", () => {
    expect([...sqlRows.keys()].sort()).toEqual(ALL_BUCKETS.map((b) => b.id).sort());
  });

  it.each(ALL_BUCKETS.map((spec) => [spec.id, spec] as const))(
    "%s matches its migration row",
    (_id, spec: BucketSpec) => {
      const row = sqlRows.get(spec.id);
      expect(row, `no row for ${spec.id} in the bucket migrations`).toBeDefined();
      expect(row!.fileSizeLimit).toBe(spec.bucketMaxBytes);
      expect(row!.mimeTypes).toEqual([...spec.mimeTypes]);
      expect(row!.isPublic).toBe(spec.isPublic);
    },
  );

  it.each(ALL_BUCKETS.map((spec) => [spec.id, spec] as const))(
    "%s is never public",
    (_id, spec: BucketSpec) => {
      // Not a style rule. A public bucket hands out permanent unauthenticated
      // URLs to passports, luggage and faces, and caches survive deletion.
      expect(spec.isPublic).toBe(false);
    },
  );

  it.each(ALL_BUCKETS.map((spec) => [spec.id, spec] as const))(
    "%s backstop is at or above the app limit",
    (_id, spec: BucketSpec) => {
      // The inverted case is the one that matters: a bucket limit BELOW the
      // app's own check means Storage rejects a file the app accepted, and the
      // customer reads a generic error instead of a size message.
      expect(spec.bucketMaxBytes).toBeGreaterThanOrEqual(spec.maxUploadBytes);
    },
  );

  it.each(ALL_BUCKETS.map((spec) => [spec.id, spec] as const))(
    "%s can name an extension for every type it accepts",
    (_id, spec: BucketSpec) => {
      for (const mimeType of spec.mimeTypes) {
        expect(extensionForUpload(spec, mimeType), mimeType).toBeTruthy();
      }
    },
  );
});

describe("client safety", () => {
  it("buckets.ts imports nothing at all", () => {
    // This is not a style preference. Client components read these limits to
    // size and filter a file picker, so the module ends up in browser bundles.
    // It once imported `../extraction/types` for two ticket constants; that
    // file imports `@koolee/db`, whose barrel pulls `client.ts` → `postgres` →
    // `fs`, and every app that referenced a spec from a "use client" file died
    // at build time with "Can't resolve 'fs'". Typecheck and lint both passed.
    const source = readFileSync(join(here, "buckets.ts"), "utf8");
    const imports = source
      .split("\n")
      .filter((line) => /^\s*import\s/.test(line) || /^\s*export\s.*\sfrom\s/.test(line));

    expect(imports).toEqual([]);
  });

  it("nothing under uploads/ reaches outside itself", () => {
    // Import lines only — the prose above explains this chain and would
    // otherwise fail its own rule.
    for (const file of ["buckets.ts", "avatar-upload.ts", "index.ts"]) {
      const specifiers = [
        ...readFileSync(join(here, file), "utf8").matchAll(
          /^\s*(?:import|export)\b[^\n]*?\sfrom\s+"([^"]+)"/gm,
        ),
      ].map((match) => match[1]!);

      for (const specifier of specifiers) {
        // Siblings are fine; a parent directory or any package is not.
        expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.\/[^.]/);
      }
    }
  });
});

describe("extensionForUpload", () => {
  it("refuses a type the bucket does not accept", () => {
    // A PDF is fine for tickets and nonsense for an avatar.
    expect(extensionForUpload(BUCKETS.avatars, "application/pdf")).toBeNull();
    expect(extensionForUpload(BUCKETS.ticketUploads, "application/pdf")).toBe("pdf");
  });

  it("refuses a type nobody accepts", () => {
    expect(extensionForUpload(BUCKETS.avatars, "image/heic")).toBeNull();
    expect(extensionForUpload(BUCKETS.avatars, "text/html")).toBeNull();
  });
});

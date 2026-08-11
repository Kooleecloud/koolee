import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as route from "./route";

/**
 * Deploy pins for the Stripe webhook endpoint. Stripe signs the EXACT bytes
 * it sends; both of these break signature verification silently on Vercel if
 * they regress:
 *
 *  - the route must run on the nodejs runtime (the edge default alters body
 *    handling and the platform APIs the SDK relies on);
 *  - the body must be read RAW via `request.text()` — `request.json()` parses
 *    and would force a re-serialisation whose bytes no longer match the
 *    signature.
 */
describe("stripe webhook route — deploy configuration", () => {
  it("declares the nodejs runtime explicitly and opts out of caching", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("exposes only POST — a GET must 405 at the framework level", () => {
    expect(typeof route.POST).toBe("function");
    expect("GET" in route).toBe(false);
  });

  it("reads the raw body with request.text(), never request.json()", () => {
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"),
      "utf8",
    );
    expect(source).toMatch(/await request\.text\(\)/);
    // The route's own comment warns against request.json(), so pin the CALL
    // form (await-ed) rather than the phrase.
    expect(source).not.toMatch(/await request\.json\(\)/);
  });
});

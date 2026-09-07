import { describe, expect, it } from "vitest";

import { flushDisposition } from "./position-queue";

/**
 * The IndexedDB plumbing around this rule is not unit-tested — the repo has
 * no `fake-indexeddb` and adding a dependency is not this slice's call — so
 * it is verified in a browser pass instead. This is the part that is worth
 * pinning without a browser: the rule that decides whether a driver's backlog
 * survives, and each of whose three ways of being wrong is invisible until a
 * driver is in a tunnel.
 */
describe("flushDisposition", () => {
  it.each([200, 201, 204])("deletes an accepted batch (%i)", (status) => {
    expect(flushDisposition(status)).toBe("delete");
  });

  /*
   * A body the server will always refuse must not become permanent luggage,
   * re-sent on every network change for the rest of the shift.
   */
  it.each([400, 401, 409, 413, 422])(
    "drops a permanently refused batch (%i)",
    (status) => {
      expect(flushDisposition(status)).toBe("delete");
    },
  );

  /*
   * THE CASE THE QUEUE EXISTS FOR. A server having a moment must not cost the
   * fixes — that is the same loss as the tunnel, arriving by a different road.
   */
  it.each([500, 502, 503, 504])("keeps a batch through a server fault (%i)", (status) => {
    expect(flushDisposition(status)).toBe("retry");
  });

  /*
   * 0 is what `fetch` reports for an opaque or aborted response in some
   * browsers. Unknown is not "permanently refused", so it is kept.
   */
  it("keeps a batch when the status is not a real one", () => {
    expect(flushDisposition(0)).toBe("retry");
  });
});

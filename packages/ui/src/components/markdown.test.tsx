import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "./markdown";

/**
 * The renderer, rendered THE WAY A SERVER COMPONENT RENDERS IT.
 *
 * Two things are being asserted at once and both matter:
 *
 *  1. the output is formatted HTML rather than the characters the operator
 *     typed. `/trips/[id]/agreement` is a server component, and what it
 *     showed was `# Koolee booking agreement`, `[privacy policy](https://…)`
 *     and a line of pipes — because `parseAgreementMarkdown` degrades
 *     anything without a branch to paragraph text, and `#`, links and tables
 *     had no branch;
 *
 *  2. this component is server-safe at all. `renderToStaticMarkup` runs with
 *     no DOM and no React dispatcher for client hooks, so a `useState` or a
 *     `useMemo` in this tree throws here. That is the `Avatar` failure — green
 *     build, green tests, 500 on first open — caught by a test rather than by
 *     a customer.
 *
 * NOT A DOM HARNESS. Nothing here clicks or types; P20 is still open.
 */

function html(markdown: string): string {
  return renderToStaticMarkup(<Markdown>{markdown}</Markdown>);
}

/** The real body ops will paste, read from the file counsel is reviewing. */
function agreementV2Body(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const draft = readFileSync(
    join(here, "..", "..", "..", "..", "docs", "launch", "agreement-v2-draft.md"),
    "utf8",
  );
  const fenced = /```markdown\n([\s\S]*?)```/.exec(draft);
  if (!fenced?.[1]) throw new Error("agreement-v2-draft.md has no ```markdown body");
  return fenced[1];
}

describe("Markdown, rendered on the server", () => {
  it("renders the agreement v2 draft as formatted output, not as source", () => {
    const out = html(agreementV2Body());

    // Every section heading is a real element.
    expect(out).toContain("<h2");
    expect(out).toContain("What you are booking");
    expect(out).toContain("Which version of this agreement applies to your booking");
    // The one bold run in the draft.
    expect(out).toContain("<strong>");

    // And nothing arrived as literal markdown.
    expect(out).not.toContain("## ");
    expect(out).not.toContain("**The version you accept");
  });

  it("renders h1, links and tables — the three that used to come out raw", () => {
    const out = html(
      [
        "# Koolee booking agreement",
        "",
        "Read the [privacy policy](https://koolee.cloud/privacy).",
        "",
        "| Charge | Amount |",
        "| --- | --- |",
        "| Base | $68 |",
      ].join("\n"),
    );

    expect(out).toContain("<h1");
    expect(out).toContain("Koolee booking agreement");
    expect(out).not.toContain("# Koolee");

    expect(out).toContain('href="https://koolee.cloud/privacy"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain("](https://");

    expect(out).toContain("<table");
    expect(out).toContain("<th");
    expect(out).toContain("<td");
    expect(out).toContain("Base");
    expect(out).not.toContain("| ---");
  });

  it("opens a web link in a new tab and an email link in place", () => {
    expect(html("[a](https://koolee.cloud/x)")).toContain('target="_blank"');
    expect(html("[b](mailto:help@koolee.cloud)")).not.toContain('target="_blank"');
  });

  /**
   * The property the whole pipeline exists to keep. An `href` is the only
   * string in it that becomes behaviour, and the allow-list lives in the AST
   * — so this is the end-to-end proof that nothing hostile survives to the
   * markup.
   */
  it("never emits a dangerous href, and never emits markup from text", () => {
    const out = html(
      [
        "[click](javascript:alert(1))",
        "",
        "## <script>alert(1)</script>",
        "",
        "A <b>bold</b> claim.",
      ].join("\n"),
    );

    // No anchor at all — the refused link degraded to text, so there is no
    // href to inspect. (`javascript:` DOES appear in the output, as the
    // escaped characters the operator typed. That is the point: the words
    // survive, the behaviour does not.)
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("href=");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<b>bold</b>");
    expect(out).toContain("[click](javascript:alert(1))");
    expect(out).toContain("&lt;script&gt;");
  });

  it("scrolls a wide table inside its own box, never the page", () => {
    const out = html("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(out).toContain("overflow-x-auto");
  });
});

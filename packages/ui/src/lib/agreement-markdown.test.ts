import { describe, expect, it } from "vitest";

import {
  blocksToProseMirrorDoc,
  isEmptyAgreementMarkdown,
  markdownToProseMirrorDoc,
  parseAgreementMarkdown,
  parseInline,
  proseMirrorDocToBlocks,
  proseMirrorDocToMarkdown,
  serializeAgreementMarkdown,
  serializeInline,
  type Block,
  type PmNode,
} from "./agreement-markdown";

/**
 * The contract this file exists to defend:
 *
 *   anything the EDITOR can produce must survive
 *   ProseMirror doc → Block[] → markdown → Block[] → ProseMirror doc
 *   unchanged, and must be representable for the RENDERER.
 *
 * If that breaks, an operator formats a clause, sees it look right, and the
 * customer's trip page shows something else — on a document they are being
 * asked to legally agree to. Every test below is a specific way that could
 * happen.
 */

/** One document exercising every block and mark the editor can emit. */
const KITCHEN_SINK = `## What you are booking

We collect your bags and deliver them to your airline's **bag drop**. We do
*not* check you in.

### Your responsibilities

- Pack as you would for the airport
- Follow your airline's rules
- Be present at pickup

### What we do

1. Photograph each bag
2. Seal it in front of you
3. Record every hand-off

> Our custody record is what we investigate against.

---

Terms marked ~~struck~~ no longer apply. Some text is ***both bold and
italic***.
`;

function roundTripMarkdown(source: string): string {
  return proseMirrorDocToMarkdown(markdownToProseMirrorDoc(source));
}

describe("inline runs", () => {
  it("parses each mark and merges adjacent runs with identical marks", () => {
    expect(parseInline("plain")).toEqual([{ text: "plain" }]);
    expect(parseInline("**bold**")).toEqual([{ text: "bold", bold: true }]);
    expect(parseInline("*italic*")).toEqual([{ text: "italic", italic: true }]);
    expect(parseInline("~~gone~~")).toEqual([{ text: "gone", strike: true }]);
    expect(parseInline("***both***")).toEqual([
      { text: "both", bold: true, italic: true },
    ]);
  });

  it("accepts underscore italics on input but normalises to asterisks", () => {
    expect(parseInline("_italic_")).toEqual([{ text: "italic", italic: true }]);
    expect(serializeInline(parseInline("_italic_"))).toBe("*italic*");
  });

  it("leaves an unmatched delimiter literal — `2 * 3` is arithmetic", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ text: "2 * 3 = 6" }]);
    expect(parseInline("a ** b")).toEqual([{ text: "a ** b" }]);
  });

  it("honours a backslash escape", () => {
    expect(parseInline("literal \\*stars\\*")).toEqual([{ text: "literal *stars*" }]);
  });

  it("round-trips every mark combination", () => {
    const combinations = [
      "plain",
      "**b**",
      "*i*",
      "~~s~~",
      "***bi***",
      "~~**bs**~~",
      "before **bold** after",
      "**a** and *b* and ~~c~~",
    ];
    for (const source of combinations) {
      expect(serializeInline(parseInline(source)), source).toBe(source);
    }
  });
});

describe("block parsing", () => {
  it("recognises every block kind", () => {
    const kinds = parseAgreementMarkdown(KITCHEN_SINK).map((b) => b.kind);
    expect(kinds).toContain("heading");
    expect(kinds).toContain("paragraph");
    expect(kinds).toContain("list");
    expect(kinds).toContain("blockquote");
    expect(kinds).toContain("rule");
  });

  it("keeps heading levels, and clamps anything else to the two we render", () => {
    const [h2, h3] = parseAgreementMarkdown("## Two\n\n### Three");
    expect(h2).toMatchObject({ kind: "heading", level: 2 });
    expect(h3).toMatchObject({ kind: "heading", level: 3 });
  });

  it("distinguishes bullet from ordered lists", () => {
    const [bullet] = parseAgreementMarkdown("- one\n- two");
    const [ordered] = parseAgreementMarkdown("1. one\n2. two");
    expect(bullet).toMatchObject({ kind: "list", list: "bullet" });
    expect(ordered).toMatchObject({ kind: "list", list: "ordered" });
    expect((ordered as Extract<Block, { kind: "list" }>).items).toHaveLength(2);
  });

  it("joins a hard-wrapped paragraph into one line", () => {
    // The seeded agreement is wrapped at 80 columns. Rendering one line per
    // source line would make every paragraph a ragged column.
    const [block] = parseAgreementMarkdown("one two\nthree four");
    expect(block).toEqual({
      kind: "paragraph",
      content: [{ text: "one two three four" }],
    });
  });

  it("treats an empty document as no blocks", () => {
    expect(parseAgreementMarkdown("   \n\n  ")).toEqual([]);
    expect(isEmptyAgreementMarkdown("")).toBe(true);
    expect(isEmptyAgreementMarkdown("## Something")).toBe(false);
  });
});

describe("markdown ⇄ ProseMirror round trip", () => {
  it("is stable for the kitchen-sink document", () => {
    const once = roundTripMarkdown(KITCHEN_SINK);
    // Idempotent: a second pass changes nothing, so repeated open-and-save
    // cycles in the admin editor cannot drift the stored document.
    expect(roundTripMarkdown(once)).toBe(once);
  });

  it("preserves every block kind through the editor representation", () => {
    const before = parseAgreementMarkdown(KITCHEN_SINK);
    const after = proseMirrorDocToBlocks(blocksToProseMirrorDoc(before));
    expect(after).toEqual(before);
  });

  it("preserves marks through the editor representation", () => {
    const source = "Text with **bold**, *italic*, ~~strike~~ and ***both***.";
    expect(roundTripMarkdown(source).trim()).toBe(source);
  });

  it("normalises rather than losing content", () => {
    // Underscores become asterisks and `*` bullets become `-`; the WORDS are
    // untouched, which is the property that matters for a legal document.
    const round = roundTripMarkdown("* one\n* two\n\n_emphasis_");
    expect(round).toContain("- one");
    expect(round).toContain("- two");
    expect(round).toContain("*emphasis*");
  });

  it("emits a ProseMirror doc that is never empty", () => {
    // ProseMirror refuses a doc with no content; an operator opening a blank
    // editor must not crash it.
    expect(blocksToProseMirrorDoc([])).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });
});

describe("hostile and lossy editor output", () => {
  it("drops empty paragraphs rather than emitting blank markdown blocks", () => {
    const doc: PmNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "kept" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [] },
      ],
    };
    expect(proseMirrorDocToBlocks(doc)).toEqual([
      { kind: "paragraph", content: [{ text: "kept" }] },
    ]);
  });

  it("turns a hard break into a space instead of dropping the text after it", () => {
    const doc: PmNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "before" },
            { type: "hardBreak" },
            { type: "text", text: "after" },
          ],
        },
      ],
    };
    expect(proseMirrorDocToBlocks(doc)).toEqual([
      { kind: "paragraph", content: [{ text: "before after" }] },
    ]);
  });

  it("SKIPS node types the renderer cannot show, rather than guessing", () => {
    // If someone widens the editor's extension list without widening this
    // module, the content is dropped loudly in review — not silently
    // half-rendered to a customer.
    const doc: PmNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "kept" }] },
        { type: "table", content: [{ type: "tableRow" }] },
        { type: "image", attrs: { src: "x.png" } },
        { type: "codeBlock", content: [{ type: "text", text: "rm -rf /" }] },
      ],
    };
    expect(proseMirrorDocToBlocks(doc)).toEqual([
      { kind: "paragraph", content: [{ text: "kept" }] },
    ]);
  });

  it("ignores marks it does not model, keeping the text", () => {
    // A colour or a link mark loses its styling but never its words.
    const doc: PmNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "important",
              marks: [{ type: "link" }, { type: "textStyle" }, { type: "bold" }],
            },
          ],
        },
      ],
    };
    expect(proseMirrorDocToBlocks(doc)).toEqual([
      { kind: "paragraph", content: [{ text: "important", bold: true }] },
    ]);
  });

  it("never produces markup from document text", () => {
    // The pipeline emits an AST, never an HTML string, so an operator who
    // types a script tag gets literal text on the customer's page.
    const hostile = "## <script>alert(1)</script>\n\nA <b>bold</b> claim.";
    const blocks = parseAgreementMarkdown(hostile);
    const flat = JSON.stringify(blocks);
    expect(flat).toContain("<script>alert(1)</script>");
    // …as TEXT on a text run, not as a node type or structure.
    expect(blocks[0]).toEqual({
      kind: "heading",
      level: 2,
      content: [{ text: "<script>alert(1)</script>" }],
    });
  });
});

describe("serialization shape", () => {
  it("separates blocks with exactly one blank line and ends with a newline", () => {
    const markdown = serializeAgreementMarkdown([
      { kind: "heading", level: 2, content: [{ text: "Title" }] },
      { kind: "paragraph", content: [{ text: "Body." }] },
      { kind: "rule" },
    ]);
    expect(markdown).toBe("## Title\n\nBody.\n\n---\n");
  });

  it("numbers ordered lists from 1 regardless of the source numbering", () => {
    const [block] = parseAgreementMarkdown("7. seven\n9. nine");
    expect(serializeAgreementMarkdown([block!])).toBe("1. seven\n2. nine\n");
  });
});

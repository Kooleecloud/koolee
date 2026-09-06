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
    //
    // `table` used to be one of these examples; slice F4 gave it a branch, so
    // the case it stands for here now is a table with NO CELLS, which carries
    // nothing and is dropped like an empty paragraph.
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
    // A colour mark, or a `link` mark with no href to speak of, loses its
    // styling but never its words. (Links WITH an href are modelled now —
    // see the F4 block below.)
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

/* ------------------------------------------------------------------ */
/* Slice F4 — h1, links and tables                                     */
/* ------------------------------------------------------------------ */

/**
 * These three constructs used to have no branch anywhere in the pipeline, and
 * the parser's "unrecognised syntax degrades to paragraph text" rule turned
 * each of them into literal characters on the customer's agreement page:
 *
 *   `# Koolee booking agreement`  → the paragraph "# Koolee booking agreement"
 *   `[terms](https://…)`          → the paragraph "[terms](https://…)"
 *   a three-row table             → one paragraph of pipes and dashes
 *
 * That is the whole of the "renders raw markdown" report. Reproduced before
 * anything was changed; these are the tests that keep it fixed.
 */

const F4_SINK = `# Koolee booking agreement

## Which terms apply

Read the [privacy policy](https://koolee.cloud/privacy) or write to
[us](mailto:help@koolee.cloud).

| Charge | Amount |
| --- | --- |
| Base | $68 |
| Per bag | $12 |
`;

describe("headings — h1", () => {
  it("parses a single # as level 1 rather than as literal text", () => {
    expect(parseAgreementMarkdown("# Title")[0]).toEqual({
      kind: "heading",
      level: 1,
      content: [{ text: "Title" }],
    });
  });

  it("still parses ## and ### as 2 and 3", () => {
    expect(parseAgreementMarkdown("## Two")[0]).toMatchObject({ level: 2 });
    expect(parseAgreementMarkdown("### Three")[0]).toMatchObject({ level: 3 });
  });

  it("round-trips every level through ProseMirror", () => {
    expect(roundTripMarkdown("# One\n\n## Two\n\n### Three\n")).toBe(
      "# One\n\n## Two\n\n### Three\n",
    );
  });

  it("clamps a pasted h4 to h3 rather than dropping the text", () => {
    const doc: PmNode = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 4 },
          content: [{ type: "text", text: "Deep" }],
        },
      ],
    };
    expect(proseMirrorDocToBlocks(doc)[0]).toEqual({
      kind: "heading",
      level: 3,
      content: [{ text: "Deep" }],
    });
  });
});

describe("links", () => {
  it("parses [label](url) into a run carrying the href", () => {
    expect(parseInline("See the [terms](https://koolee.cloud/terms) now")).toEqual([
      { text: "See the " },
      { text: "terms", link: "https://koolee.cloud/terms" },
      { text: " now" },
    ]);
  });

  it("accepts mailto", () => {
    expect(parseInline("[us](mailto:help@koolee.cloud)")).toEqual([
      { text: "us", link: "mailto:help@koolee.cloud" },
    ]);
  });

  /**
   * `safeLinkHref` returns the URL a browser would have resolved, not the
   * characters that were typed. The first save of a pasted document may
   * therefore adjust an href very slightly; every save after that is a no-op,
   * which is what keeps the round-trip contract true.
   */
  it("normalises the href, and is idempotent from the second pass", () => {
    expect(parseInline("[x](https://k.example)")).toEqual([
      { text: "x", link: "https://k.example/" },
    ]);
    const once = serializeAgreementMarkdown(
      parseAgreementMarkdown("[x](https://k.example)"),
    );
    expect(serializeAgreementMarkdown(parseAgreementMarkdown(once))).toBe(once);
  });

  it("keeps emphasis inside a link label", () => {
    expect(parseInline("[**Terms**](https://k.example/t)")).toEqual([
      { text: "Terms", bold: true, link: "https://k.example/t" },
    ]);
  });

  it("does not break a URL containing balanced parentheses", () => {
    expect(parseInline("[wiki](https://e.example/a_(b))")).toEqual([
      { text: "wiki", link: "https://e.example/a_(b)" },
    ]);
  });

  it("leaves an unclosed or empty construct as literal text", () => {
    expect(parseInline("see [1] (above)")).toEqual([{ text: "see [1] (above)" }]);
    expect(parseInline("[](https://k.example)")).toEqual([
      { text: "[](https://k.example)" },
    ]);
  });

  it("round-trips through markdown and through ProseMirror", () => {
    const source = "Read the [terms](https://koolee.cloud/terms).\n";
    expect(serializeAgreementMarkdown(parseAgreementMarkdown(source))).toBe(source);
    expect(roundTripMarkdown(source)).toBe(source);
  });

  it("does not merge adjacent links to different targets", () => {
    const runs = parseInline("[a](https://k.example/a)[b](https://k.example/b)");
    expect(runs).toHaveLength(2);
    expect(runs[0]!.link).toBe("https://k.example/a");
    expect(runs[1]!.link).toBe("https://k.example/b");
  });

  /**
   * The one place a string becomes behaviour. An allow-list of http/https/
   * mailto, applied in the AST rather than in the renderer — every consumer
   * gets the same answer, and the words survive even when the link does not.
   */
  describe("refuses every scheme but http, https and mailto", () => {
    for (const hostile of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "/relative/path",
      "//evil.example/x",
    ]) {
      it(hostile, () => {
        const runs = parseInline(`[click](${hostile})`);
        // Literal text, brackets intact — never a run with a link.
        expect(runs.every((r) => r.link === undefined)).toBe(true);
        expect(runs.map((r) => r.text).join("")).toContain("click");
      });
    }

    it("also refuses one arriving from the editor, not just from markdown", () => {
      const doc: PmNode = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "click",
                marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
              },
            ],
          },
        ],
      };
      expect(proseMirrorDocToBlocks(doc)[0]).toEqual({
        kind: "paragraph",
        content: [{ text: "click" }],
      });
    });
  });
});

describe("tables", () => {
  const TABLE = "| Charge | Amount |\n| --- | --- |\n| Base | $68 |";

  it("parses a header, a delimiter and body rows", () => {
    expect(parseAgreementMarkdown(TABLE)[0]).toEqual({
      kind: "table",
      header: [[{ text: "Charge" }], [{ text: "Amount" }]],
      rows: [[[{ text: "Base" }], [{ text: "$68" }]]],
    });
  });

  it("needs the delimiter row — prose containing a pipe stays a paragraph", () => {
    expect(parseAgreementMarkdown("either | or")[0]).toEqual({
      kind: "paragraph",
      content: [{ text: "either | or" }],
    });
  });

  it("keeps marks and links inside a cell", () => {
    const [block] = parseAgreementMarkdown(
      "| a | b |\n| --- | --- |\n| **bold** | [x](https://k.example) |",
    );
    expect(block).toMatchObject({
      rows: [
        [[{ text: "bold", bold: true }], [{ text: "x", link: "https://k.example/" }]],
      ],
    });
  });

  it("treats an escaped pipe as a literal, not a column break", () => {
    const [block] = parseAgreementMarkdown("| a |\n| --- |\n| one \\| two |");
    expect(block).toMatchObject({ rows: [[[{ text: "one | two" }]]] });
    // …and writes it back escaped, so a second read agrees with the first.
    expect(serializeAgreementMarkdown([block!])).toContain("one \\| two");
  });

  it("pads a ragged table to a rectangle on the way out", () => {
    const [block] = parseAgreementMarkdown("| a | b |\n| --- | --- |\n| one |");
    expect(serializeAgreementMarkdown([block!])).toBe(
      "| a | b |\n| --- | --- |\n| one |  |\n",
    );
  });

  it("round-trips through markdown and through ProseMirror", () => {
    const source = `${TABLE}\n`;
    expect(serializeAgreementMarkdown(parseAgreementMarkdown(source))).toBe(source);
    expect(roundTripMarkdown(source)).toBe(source);
  });
});

describe("the F4 document, end to end", () => {
  it("produces no paragraph that is raw markdown", () => {
    const blocks = parseAgreementMarkdown(F4_SINK);
    const paragraphs = blocks
      .filter((b): b is Extract<Block, { kind: "paragraph" }> => b.kind === "paragraph")
      .flatMap((b) => b.content.map((r) => r.text));
    for (const text of paragraphs) {
      expect(text).not.toMatch(/^#/);
      expect(text).not.toContain("](http");
      expect(text).not.toContain("| ---");
    }
    expect(blocks.map((b) => b.kind)).toEqual([
      "heading",
      "heading",
      "paragraph",
      "table",
    ]);
    expect(blocks[0]).toMatchObject({ level: 1 });
  });

  it("is stable across a full round trip", () => {
    const once = serializeAgreementMarkdown(parseAgreementMarkdown(F4_SINK));
    expect(serializeAgreementMarkdown(parseAgreementMarkdown(once))).toBe(once);
    expect(roundTripMarkdown(F4_SINK)).toBe(once);
  });
});

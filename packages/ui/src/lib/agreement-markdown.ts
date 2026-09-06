/**
 * The one definition of what an agreement document can contain.
 *
 * WHY THIS MODULE EXISTS
 *
 * An agreement is authored in a rich-text editor, stored as Markdown, and
 * rendered to the customer by our own renderer. That is three representations
 * and two conversions, and the failure it invites is the worst kind for a
 * legal document: an operator formats a clause, sees it look right in the
 * editor, and the customer's trip page silently drops it or shows literal
 * `**asterisks**`.
 *
 * So the editor and the renderer are not two implementations that we try to
 * keep in step. They are two consumers of the AST below. `Block[]` is the
 * contract:
 *
 *     markdown ──parse──▶ Block[] ──▶ ProseMirror doc   (the editor)
 *                             │
 *                             └─────▶ React elements    (the customer)
 *     markdown ◀─serialize── Block[] ◀── ProseMirror doc (saving)
 *
 * Anything the editor can produce must survive `docToBlocks` → `serialize` →
 * `parse` unchanged, and must render. `agreement-markdown.test.ts` asserts
 * exactly that. Adding a feature means adding it HERE first; if it cannot be
 * expressed as a `Block`, the editor must not offer it.
 *
 * LINKS AND TABLES ARE PART OF THE CONTRACT NOW (slice F4)
 *
 * They were deliberately absent, and the argument against links was a good
 * one: an agreement whose terms live behind a link is an agreement whose
 * terms are not versioned. What settled it the other way is that the
 * exclusion was never enforced — it was a comment. `parseAgreementMarkdown`
 * degrades anything it does not recognise to paragraph text, so an operator
 * who pasted a link got the literal characters `[privacy policy](https://…)`
 * on the customer's agreement page, and a pasted table got every one of its
 * pipes and dashes joined into one line. "Not supported" and "rendered as
 * gibberish in a legal document" are not the same policy, and only the
 * second one was actually shipping.
 *
 * So they are supported, end to end, and the versioning argument is answered
 * where it belongs — in the agreement's own text, which now says which
 * version governs a booking.
 *
 * A LINK HREF IS THE ONE PLACE A STRING BECOMES BEHAVIOUR. Everything else
 * in this pipeline is text; an `href` is not. `safeLinkHref` allows `http`,
 * `https` and `mailto` and NOTHING else, so `javascript:`, `data:` and
 * `vbscript:` survive as plain text rather than as a link — the run keeps its
 * words and loses its `link`. That check lives here, in the AST, rather than
 * in the renderer, because the renderer is not the only consumer.
 *
 * WHAT IS STILL DELIBERATELY ABSENT
 *
 *  - images, code blocks, colour, alignment, collapsible sections — see the
 *    note in the admin editor for why each is wrong here rather than merely
 *    unimplemented;
 *  - nested lists. One level only, and the editor disables sinking, so an
 *    operator cannot author what this cannot represent. Sub-clauses are a
 *    real need in legal prose and this is the most likely next addition —
 *    it lands here, in the AST, first.
 *  - marks inside a table cell beyond the inline set. A cell is `TextRun[]`,
 *    the same as everywhere else; a cell cannot hold a list or a heading.
 *  - raw HTML. Nothing in this pipeline ever produces markup from a string,
 *    which is what makes an operator-authored document safe to render.
 */

/* ------------------------------------------------------------------ */
/* The AST                                                             */
/* ------------------------------------------------------------------ */

/**
 * Inline content as flat RUNS carrying a mark set, rather than a tree.
 *
 * This is how ProseMirror models inline content, so the editor conversion is
 * a direct mapping rather than a reconstruction — and "bold inside italic"
 * versus "italic inside bold" stops being a distinction that can round-trip
 * differently, because it is not representable. Both are simply a run marked
 * bold and italic.
 */
export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  /**
   * An absolute `http`/`https`/`mailto` URL, or absent.
   *
   * Never a raw operator string: everything that reaches this field has been
   * through `safeLinkHref`. A rejected URL leaves the field absent and the
   * text intact, so a hostile paste degrades to prose rather than to a live
   * link — see the header.
   */
  link?: string;
}

export type ListKind = "bullet" | "ordered";

/**
 * `#`, `##`, `###`. h1 was missing, which meant a document that opened with a
 * single `#` — the shape every markdown author reaches for first — rendered
 * its own title as the literal characters `# Koolee booking agreement`.
 */
export type HeadingLevel = 1 | 2 | 3;

/**
 * One table. `header` is a row of cells; `rows` is zero or more further rows.
 *
 * The header is separate rather than `rows[0]` because markdown's delimiter
 * line makes it structurally distinct, and because a renderer needs to know
 * which cells are `<th>` without counting. Rows are NOT padded to a common
 * width here — `columnCount` is what every consumer should use, so a ragged
 * paste renders as a rectangle instead of throwing the layout away.
 */
export interface TableBlock {
  kind: "table";
  header: TextRun[][];
  rows: TextRun[][][];
}

export type Block =
  | { kind: "heading"; level: HeadingLevel; content: TextRun[] }
  | { kind: "paragraph"; content: TextRun[] }
  | { kind: "blockquote"; content: TextRun[][] }
  | { kind: "list"; list: ListKind; items: TextRun[][] }
  | TableBlock
  | { kind: "rule" };

/** The widest row, header included. Never below the header's own width. */
export function columnCount(block: TableBlock): number {
  return Math.max(block.header.length, ...block.rows.map((row) => row.length), 1);
}

/* ------------------------------------------------------------------ */
/* Inline parsing                                                      */
/* ------------------------------------------------------------------ */

/**
 * Delimiters, longest-first so `***` is matched before `**` and `**` before
 * `*`. `_` is accepted for italic on input (people paste it) but never
 * emitted — `serializeInline` always writes `*`, so a round trip normalises.
 */
const DELIMITERS: ReadonlyArray<{
  token: string;
  marks: Array<keyof Omit<TextRun, "text">>;
}> = [
  { token: "***", marks: ["bold", "italic"] },
  { token: "**", marks: ["bold"] },
  { token: "~~", marks: ["strike"] },
  { token: "*", marks: ["italic"] },
  { token: "_", marks: ["italic"] },
];

/**
 * The only gate between an operator's typing and an `href`.
 *
 * ALLOW-LIST, NOT DENY-LIST. `http`, `https`, `mailto`. A deny-list here
 * would have to anticipate `javascript:`, `data:`, `vbscript:`, `file:`, the
 * `java\u0000script:` variants, and whatever a browser normalises next; an
 * allow-list has to anticipate nothing.
 *
 * A rejected URL returns `undefined` and the caller keeps the run's TEXT —
 * the words survive, the behaviour does not. Silently dropping the whole
 * phrase from a legal document would be worse than showing it unlinked.
 *
 * Relative and protocol-relative URLs are rejected too. An agreement is
 * rendered on the customer app, the admin console and a print view; "the
 * page this is relative to" is three different answers, and `//evil.example`
 * is an absolute URL wearing a relative one's clothes.
 */
export function safeLinkHref(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // `new URL` performs the same scheme normalisation a browser would —
  // whitespace, control characters and case are all handled before we look.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (
    parsed.protocol !== "http:" &&
    parsed.protocol !== "https:" &&
    parsed.protocol !== "mailto:"
  ) {
    return undefined;
  }
  /*
   * The NORMALISED form, not what was typed. `https://k.example` comes back
   * as `https://k.example/`, and a smuggled control character is encoded
   * rather than passed along.
   *
   * That means the first save of a pasted document may rewrite an href very
   * slightly. It is idempotent from then on — normalising an already
   * normalised URL is a no-op — so the round-trip contract holds from the
   * second pass, and what is stored is what a browser would have resolved
   * anyway. Storing the raw string instead would keep a form that only LOOKS
   * like what was validated.
   */
  return parsed.href;
}

function pushRun(
  runs: TextRun[],
  text: string,
  active: Set<string>,
  link?: string,
): void {
  if (!text) return;
  const last = runs[runs.length - 1];
  const run: TextRun = { text };
  if (active.has("bold")) run.bold = true;
  if (active.has("italic")) run.italic = true;
  if (active.has("strike")) run.strike = true;
  if (link) run.link = link;

  // Merge adjacent runs with identical marks so `**a****b**` is one run, and
  // so a round trip cannot fragment text into progressively smaller pieces.
  // The link counts as a mark here: two adjacent links to DIFFERENT targets
  // must never merge into one, and merging same-target neighbours is exactly
  // what keeps `[a](u)[b](u)` from fragmenting across a round trip.
  if (
    last &&
    Boolean(last.bold) === Boolean(run.bold) &&
    Boolean(last.italic) === Boolean(run.italic) &&
    Boolean(last.strike) === Boolean(run.strike) &&
    last.link === run.link
  ) {
    last.text += run.text;
    return;
  }
  runs.push(run);
}

/**
 * `[label](href)` starting at `start`, or null.
 *
 * Hand-scanned rather than a regex because the label may contain balanced
 * brackets and the href may contain parentheses — `[see](https://x/a_(b))` is
 * a real URL shape, and a lazy regex truncates it at the first `)`.
 * Depth-counted on both, which is what a regex cannot do.
 *
 * The href goes through `safeLinkHref` HERE. A refused scheme returns null,
 * so the whole construct falls through to literal text with its brackets
 * intact — the reader sees what the author typed rather than a link that
 * silently lost its destination.
 */
function matchLink(
  source: string,
  start: number,
): { label: string; href: string; end: number } | null {
  let i = start + 1;
  let depth = 1;
  let label = "";
  while (i < source.length && depth > 0) {
    const ch = source[i]!;
    if (ch === "\\" && i + 1 < source.length) {
      label += source[i + 1];
      i += 2;
      continue;
    }
    if (ch === "[") depth += 1;
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
    label += ch;
    i += 1;
  }
  if (depth !== 0 || source[i + 1] !== "(") return null;
  if (!label.trim()) return null;

  i += 2;
  let paren = 1;
  let href = "";
  while (i < source.length && paren > 0) {
    const ch = source[i]!;
    if (ch === "\\" && i + 1 < source.length) {
      href += source[i + 1];
      i += 2;
      continue;
    }
    if (ch === "(") paren += 1;
    if (ch === ")") {
      paren -= 1;
      if (paren === 0) break;
    }
    href += ch;
    i += 1;
  }
  if (paren !== 0) return null;

  const safe = safeLinkHref(href);
  if (!safe) return null;
  return { label, href: safe, end: i + 1 };
}

/**
 * Scans one line into marked runs.
 *
 * An unmatched delimiter stays literal — `2 * 3 * 4` is arithmetic, not
 * emphasis. That is decided by looking ahead for a closing token before
 * opening a mark, which is also what stops a stray asterisk from italicising
 * the rest of a clause.
 */
export function parseInline(source: string): TextRun[] {
  const runs: TextRun[] = [];
  const active = new Set<string>();
  let buffer = "";
  let i = 0;

  outer: while (i < source.length) {
    // Escapes: \* stays a literal asterisk.
    if (source[i] === "\\" && i + 1 < source.length) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }

    /*
     * `[text](url)`, tried BEFORE the emphasis delimiters so a link label may
     * itself be emphasised (`[**Terms**](…)`): the label is re-parsed through
     * `parseInline`, and each of its runs inherits the href.
     *
     * A malformed link — no closing `)`, an empty label, a URL the allow-list
     * refuses — is not an error. The characters stay exactly as typed, which
     * is the same rule an unmatched `*` follows, and it is why a clause
     * containing `see [1] (above)` is prose rather than a broken link.
     */
    if (source[i] === "[") {
      const link = matchLink(source, i);
      if (link) {
        pushRun(runs, buffer, active);
        buffer = "";
        for (const inner of parseInline(link.label)) {
          const nested = new Set(active);
          if (inner.bold) nested.add("bold");
          if (inner.italic) nested.add("italic");
          if (inner.strike) nested.add("strike");
          pushRun(runs, inner.text, nested, link.href);
        }
        i = link.end;
        continue;
      }
    }

    for (const { token, marks } of DELIMITERS) {
      if (!source.startsWith(token, i)) continue;

      const closing = marks.every((m) => active.has(m));
      if (closing) {
        pushRun(runs, buffer, active);
        buffer = "";
        for (const m of marks) active.delete(m);
        i += token.length;
        continue outer;
      }

      // Only open a mark if it actually closes later in this line.
      const hasClose = source.indexOf(token, i + token.length) !== -1;
      const alreadyOpen = marks.some((m) => active.has(m));
      if (hasClose && !alreadyOpen) {
        pushRun(runs, buffer, active);
        buffer = "";
        for (const m of marks) active.add(m);
        i += token.length;
        continue outer;
      }
      // Unmatched — fall through and treat as literal text.
      break;
    }

    buffer += source[i];
    i += 1;
  }

  pushRun(runs, buffer, active);
  return runs;
}

/** Runs → markdown. Always emits `*` for italic, never `_`. */
export function serializeInline(runs: TextRun[]): string {
  return runs
    .map((run) => {
      let text = run.text;
      if (!text) return "";
      // Order matters and must be the inverse of the parser's precedence:
      // strike outermost, then bold, then italic.
      if (run.italic) text = `*${text}*`;
      if (run.bold) text = `**${text}**`;
      if (run.strike) text = `~~${text}~~`;
      // The link is OUTERMOST, so `[**Terms**](…)` round-trips: the parser
      // matches the link first and re-parses the label, which is the inverse
      // of writing the marks inside the brackets.
      if (run.link) text = `[${text}](${run.link})`;
      return text;
    })
    .join("");
}

/* ------------------------------------------------------------------ */
/* Block parsing                                                       */
/* ------------------------------------------------------------------ */

const HEADING = /^(#{1,3})\s+(.*)$/;
const RULE = /^-{3,}$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
/** A table row: at least one `|`, and the line begins or ends with one. */
const TABLE_ROW = /^\s*\|.*\|\s*$/;
/** The delimiter line under the header: `| --- | :--: |`. Alignment ignored. */
const TABLE_DELIMITER = /^\s*\|(?:\s*:?-{1,}:?\s*\|)+\s*$/;

/**
 * `| a | b |` → `["a", "b"]`.
 *
 * Splits on unescaped pipes only, so `\|` inside a cell is a literal pipe
 * rather than a column break — the one escape a table author actually needs.
 * The leading and trailing empty cells that the outer pipes produce are
 * dropped; an interior empty cell is kept, because a blank cell is data.
 */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  const trimmed = line.trim();
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    if (ch === "\\" && trimmed[i + 1] === "|") {
      cell += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += ch;
  }
  cells.push(cell);
  // The outer pipes give an empty first and last element. Remove exactly
  // those, never an interior blank.
  if (cells.length && cells[0]!.trim() === "") cells.shift();
  if (cells.length && cells[cells.length - 1]!.trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

/** Markdown → `Block[]`. Unrecognised syntax degrades to paragraph text. */
export function parseAgreementMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  // Normalise CRLF so a Windows-pasted document does not leave \r in every
  // heading and list marker.
  const paragraphs = source.replace(/\r\n/g, "\n").split(/\n{2,}/);

  for (const raw of paragraphs) {
    const block = raw.trim();
    if (!block) continue;

    if (RULE.test(block)) {
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING.exec(block);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1]!.length as HeadingLevel,
        content: parseInline(heading[2]!.trim()),
      });
      continue;
    }

    const lines = block.split("\n");

    /*
     * A table is a header row, a delimiter row, and any number of body rows.
     * The delimiter is what makes it a table rather than prose that happens
     * to contain pipes — without it, `a | b` stays a paragraph, which is what
     * an operator writing "either | or" means.
     */
    if (
      lines.length >= 2 &&
      TABLE_ROW.test(lines[0]!) &&
      TABLE_DELIMITER.test(lines[1]!) &&
      lines.slice(2).every((line) => TABLE_ROW.test(line))
    ) {
      blocks.push({
        kind: "table",
        header: splitRow(lines[0]!).map(parseInline),
        rows: lines.slice(2).map((line) => splitRow(line).map(parseInline)),
      });
      continue;
    }

    if (lines.every((line) => QUOTE.test(line))) {
      blocks.push({
        kind: "blockquote",
        content: lines.map((line) => parseInline(QUOTE.exec(line)![1]!.trim())),
      });
      continue;
    }

    if (lines.every((line) => BULLET.test(line))) {
      blocks.push({
        kind: "list",
        list: "bullet",
        items: lines.map((line) => parseInline(BULLET.exec(line)![1]!.trim())),
      });
      continue;
    }

    if (lines.every((line) => ORDERED.test(line))) {
      blocks.push({
        kind: "list",
        list: "ordered",
        items: lines.map((line) => parseInline(ORDERED.exec(line)![1]!.trim())),
      });
      continue;
    }

    // Soft-wrapped paragraph: the seeded body is hard-wrapped at 80 columns
    // and must not render as one line per source line.
    blocks.push({ kind: "paragraph", content: parseInline(lines.join(" ")) });
  }

  return blocks;
}

/** `Block[]` → markdown. Blocks are separated by a blank line, always. */
export function serializeAgreementMarkdown(blocks: Block[]): string {
  return (
    blocks
      .map((block) => {
        switch (block.kind) {
          case "rule":
            return "---";
          case "heading":
            return `${"#".repeat(block.level)} ${serializeInline(block.content)}`;
          case "paragraph":
            return serializeInline(block.content);
          case "blockquote":
            return block.content.map((line) => `> ${serializeInline(line)}`).join("\n");
          case "list":
            return block.items
              .map((item, i) =>
                block.list === "bullet"
                  ? `- ${serializeInline(item)}`
                  : `${i + 1}. ${serializeInline(item)}`,
              )
              .join("\n");
          case "table": {
            // Padded to a rectangle on the way OUT, so a table the editor
            // produced ragged is stored square and parses back identically.
            // A literal pipe in a cell is escaped, or it would become a
            // column break the next time this is read.
            const width = columnCount(block);
            const cell = (runs: TextRun[] | undefined) =>
              serializeInline(runs ?? []).replaceAll("|", "\\|");
            const row = (cells: TextRun[][]) =>
              `| ${Array.from({ length: width }, (_, i) => cell(cells[i])).join(" | ")} |`;
            return [
              row(block.header),
              `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
              ...block.rows.map(row),
            ].join("\n");
          }
        }
      })
      .filter((s) => s.length > 0)
      .join("\n\n") + "\n"
  );
}

/* ------------------------------------------------------------------ */
/* ProseMirror conversion                                              */
/* ------------------------------------------------------------------ */

/**
 * Minimal structural types for the ProseMirror JSON we produce and consume.
 * Deliberately not imported from `@tiptap/pm` — this module is pure and must
 * stay importable (and testable) without pulling the editor in.
 */
export interface PmMark {
  type: string;
  /** `link` carries `{ href }`; every other mark carries nothing. */
  attrs?: Record<string, unknown>;
}
export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: PmMark[];
  text?: string;
  content?: PmNode[];
}

const MARK_FOR: Record<string, string> = {
  bold: "bold",
  italic: "italic",
  strike: "strike",
};

function runsToPm(runs: TextRun[]): PmNode[] {
  return runs
    .filter((run) => run.text.length > 0)
    .map((run) => {
      const marks: PmMark[] = [];
      if (run.bold) marks.push({ type: MARK_FOR.bold! });
      if (run.italic) marks.push({ type: MARK_FOR.italic! });
      if (run.strike) marks.push({ type: MARK_FOR.strike! });
      if (run.link) marks.push({ type: "link", attrs: { href: run.link } });
      return marks.length > 0
        ? { type: "text", text: run.text, marks }
        : { type: "text", text: run.text };
    });
}

function pmToRuns(content: PmNode[] | undefined): TextRun[] {
  const runs: TextRun[] = [];
  const active = new Set<string>();
  for (const node of content ?? []) {
    // A hard break inside a paragraph becomes a space: the AST has no
    // intra-paragraph break, and silently dropping the text either side
    // would be worse than joining it.
    if (node.type === "hardBreak") {
      pushRun(runs, " ", active);
      continue;
    }
    if (node.type !== "text" || !node.text) continue;
    const marks = new Set((node.marks ?? []).map((m) => m.type));
    const run: TextRun = { text: node.text };
    if (marks.has("bold")) run.bold = true;
    if (marks.has("italic")) run.italic = true;
    if (marks.has("strike")) run.strike = true;
    // The href is re-validated on the way IN, not trusted because it came
    // from the editor. Tiptap's own link extension will happily hold whatever
    // a paste put there, and this is the boundary where a document becomes
    // something we store and later render.
    const linkMark = (node.marks ?? []).find((m) => m.type === "link");
    const href =
      typeof linkMark?.attrs?.["href"] === "string"
        ? safeLinkHref(linkMark.attrs["href"])
        : undefined;
    if (href) run.link = href;
    const set = new Set<string>();
    if (run.bold) set.add("bold");
    if (run.italic) set.add("italic");
    if (run.strike) set.add("strike");
    pushRun(runs, run.text, set, run.link);
  }
  return runs;
}

/** `Block[]` → a ProseMirror `doc`, ready for `editor.commands.setContent`. */
export function blocksToProseMirrorDoc(blocks: Block[]): PmNode {
  const content: PmNode[] = blocks.map((block) => {
    switch (block.kind) {
      case "rule":
        return { type: "horizontalRule" };
      case "heading":
        return {
          type: "heading",
          attrs: { level: block.level },
          content: runsToPm(block.content),
        };
      case "paragraph":
        return { type: "paragraph", content: runsToPm(block.content) };
      case "blockquote":
        return {
          type: "blockquote",
          content: block.content.map((line) => ({
            type: "paragraph",
            content: runsToPm(line),
          })),
        };
      case "list":
        return {
          type: block.list === "bullet" ? "bulletList" : "orderedList",
          content: block.items.map((item) => ({
            type: "listItem",
            content: [{ type: "paragraph", content: runsToPm(item) }],
          })),
        };
      case "table": {
        // Padded to `columnCount` here as well as in the serializer: a
        // ProseMirror table with rows of different lengths is an invalid
        // document, and Tiptap's response to one is to drop content.
        const width = columnCount(block);
        const cells = (row: TextRun[][], type: "tableHeader" | "tableCell"): PmNode[] =>
          Array.from({ length: width }, (_, i) => ({
            type,
            content: [{ type: "paragraph", content: runsToPm(row[i] ?? []) }],
          }));
        return {
          type: "table",
          content: [
            { type: "tableRow", content: cells(block.header, "tableHeader") },
            ...block.rows.map((row) => ({
              type: "tableRow",
              content: cells(row, "tableCell"),
            })),
          ],
        };
      }
    }
  });
  // An empty doc still needs one paragraph or ProseMirror refuses it.
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

/** A ProseMirror `doc` → `Block[]`. Unknown node types are skipped, not guessed. */
export function proseMirrorDocToBlocks(doc: PmNode): Block[] {
  const blocks: Block[] = [];

  for (const node of doc.content ?? []) {
    switch (node.type) {
      case "horizontalRule":
        blocks.push({ kind: "rule" });
        break;
      case "heading": {
        const raw = Number(node.attrs?.["level"] ?? 2);
        const content = pmToRuns(node.content);
        if (content.length === 0) break;
        // Clamped, not trusted: the toolbar offers 1–3, but a paste can carry
        // an h4 and the AST has no room for one. Anything deeper reads as h3,
        // which keeps the text and loses only a level of nesting.
        const level: HeadingLevel = raw <= 1 ? 1 : raw === 2 ? 2 : 3;
        blocks.push({ kind: "heading", level, content });
        break;
      }
      case "table": {
        const rows = (node.content ?? [])
          .filter((row) => row.type === "tableRow")
          .map((row) =>
            (row.content ?? []).map((cellNode) =>
              (cellNode.content ?? []).flatMap((child) =>
                child.type === "paragraph" ? pmToRuns(child.content) : [],
              ),
            ),
          );
        // A table with no rows, or whose header has no cells, carries nothing
        // — the same rule empty paragraphs follow. A table whose ONLY row is
        // a populated header is legitimate: an operator still filling it in.
        const [header, ...body] = rows;
        if (!header || header.length === 0) break;
        blocks.push({ kind: "table", header, rows: body });
        break;
      }
      case "paragraph": {
        const content = pmToRuns(node.content);
        // Empty paragraphs are how an editor represents a blank line; blocks
        // are already separated by one, so they carry no meaning here.
        if (content.length === 0) break;
        blocks.push({ kind: "paragraph", content });
        break;
      }
      case "blockquote": {
        const lines = (node.content ?? [])
          .map((child) => pmToRuns(child.content))
          .filter((runs) => runs.length > 0);
        if (lines.length === 0) break;
        blocks.push({ kind: "blockquote", content: lines });
        break;
      }
      case "bulletList":
      case "orderedList": {
        const items = (node.content ?? [])
          .map((item) =>
            (item.content ?? []).flatMap((child) =>
              child.type === "paragraph" ? pmToRuns(child.content) : [],
            ),
          )
          .filter((runs) => runs.length > 0);
        if (items.length === 0) break;
        blocks.push({
          kind: "list",
          list: node.type === "bulletList" ? "bullet" : "ordered",
          items,
        });
        break;
      }
      default:
        break;
    }
  }

  return blocks;
}

/* ------------------------------------------------------------------ */
/* Convenience                                                         */
/* ------------------------------------------------------------------ */

/** Markdown → ProseMirror doc, for loading a stored version into the editor. */
export function markdownToProseMirrorDoc(source: string): PmNode {
  return blocksToProseMirrorDoc(parseAgreementMarkdown(source));
}

/** ProseMirror doc → markdown, for saving what the editor produced. */
export function proseMirrorDocToMarkdown(doc: PmNode): string {
  return serializeAgreementMarkdown(proseMirrorDocToBlocks(doc));
}

/** True when the document has no renderable content. */
export function isEmptyAgreementMarkdown(source: string): boolean {
  return parseAgreementMarkdown(source).length === 0;
}

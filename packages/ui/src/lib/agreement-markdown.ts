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
 * WHAT IS DELIBERATELY ABSENT
 *
 *  - links — an agreement whose terms live behind a link is an agreement
 *    whose terms are not versioned. Show related material in the page around
 *    the document instead;
 *  - images, tables, code blocks, colour, alignment, collapsible sections —
 *    see the note in the admin editor for why each is wrong here rather than
 *    merely unimplemented;
 *  - nested lists. One level only, and the editor disables sinking, so an
 *    operator cannot author what this cannot represent. Sub-clauses are a
 *    real need in legal prose and this is the most likely next addition —
 *    it lands here, in the AST, first.
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
}

export type ListKind = "bullet" | "ordered";

export type Block =
  | { kind: "heading"; level: 2 | 3; content: TextRun[] }
  | { kind: "paragraph"; content: TextRun[] }
  | { kind: "blockquote"; content: TextRun[][] }
  | { kind: "list"; list: ListKind; items: TextRun[][] }
  | { kind: "rule" };

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

function pushRun(runs: TextRun[], text: string, active: Set<string>): void {
  if (!text) return;
  const last = runs[runs.length - 1];
  const run: TextRun = { text };
  if (active.has("bold")) run.bold = true;
  if (active.has("italic")) run.italic = true;
  if (active.has("strike")) run.strike = true;

  // Merge adjacent runs with identical marks so `**a****b**` is one run, and
  // so a round trip cannot fragment text into progressively smaller pieces.
  if (
    last &&
    Boolean(last.bold) === Boolean(run.bold) &&
    Boolean(last.italic) === Boolean(run.italic) &&
    Boolean(last.strike) === Boolean(run.strike)
  ) {
    last.text += run.text;
    return;
  }
  runs.push(run);
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
      return text;
    })
    .join("");
}

/* ------------------------------------------------------------------ */
/* Block parsing                                                       */
/* ------------------------------------------------------------------ */

const HEADING = /^(#{2,3})\s+(.*)$/;
const RULE = /^-{3,}$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

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
        level: heading[1]!.length === 2 ? 2 : 3,
        content: parseInline(heading[2]!.trim()),
      });
      continue;
    }

    const lines = block.split("\n");

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
    const set = new Set<string>();
    if (run.bold) set.add("bold");
    if (run.italic) set.add("italic");
    if (run.strike) set.add("strike");
    pushRun(runs, run.text, set);
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
        blocks.push({ kind: "heading", level: raw === 3 ? 3 : 2, content });
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

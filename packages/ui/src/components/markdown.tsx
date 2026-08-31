import * as React from "react";

import {
  columnCount,
  parseAgreementMarkdown,
  type Block,
  type TableBlock,
  type TextRun,
} from "../lib/agreement-markdown";
import { cn } from "../lib/utils";

/**
 * The customer-facing view of an agreement document.
 *
 * It renders the SAME `Block[]` AST the admin editor is built on
 * (`lib/agreement-markdown.ts`), which is the whole point: the editor cannot
 * offer a construct this cannot draw, because both are consumers of one
 * definition rather than two implementations kept in step by discipline.
 *
 * Nothing here can inject markup. There is no `dangerouslySetInnerHTML` and
 * no HTML string anywhere in the pipeline — an operator who types a `<script>`
 * tag into the editor gets those characters on screen, as text. That property
 * is worth more than the convenience of a general-purpose renderer, which is
 * why this is hand-written rather than a library whose escape hatch is raw
 * HTML.
 *
 * THE ONE EXCEPTION IS A LINK, and it is handled upstream. An `href` is the
 * only place in this pipeline where a string becomes behaviour rather than
 * text, so `safeLinkHref` in the AST allows `http`, `https` and `mailto` and
 * nothing else. By the time a run reaches this file its `link` has already
 * been through that gate; this component does not re-check and must not be
 * given a run that skipped it.
 *
 * A NOTE ON THIS FILE'S HISTORY, because the comment that used to be here
 * predicted the wrong bug (slice F4).
 *
 * It read: "CLIENT COMPONENT: `useMemo` for the parsed AST. Today the only
 * caller is already a client component, so this never fired — but that made
 * it a trap set for the first server component to render an agreement body."
 *
 * A server component then did render one — `/trips/[id]/agreement` — and the
 * trap did not spring, because the same sweep that wrote the warning also
 * added the `"use client"` directive that defused it. The prophecy was
 * already its own fix.
 *
 * What DID ship was a different failure with the same symptom, and it is the
 * reason this file was reopened: the renderer had no branch for `#`, for
 * links, or for tables, and `parseAgreementMarkdown` degrades anything it
 * does not recognise to paragraph text. So an agreement that opened with a
 * single `#` displayed the literal characters `# Koolee booking agreement`,
 * a link displayed as `[privacy policy](https://…)`, and a table displayed as
 * one line of pipes and dashes. "Renders raw markdown" was never a
 * server/client boundary problem. It was a missing `case`.
 *
 * The `useMemo` is gone with the directive. Parsing is a pure string scan and
 * this is now safe to render from a server component OR a client one — which
 * is what the original comment was reaching for, arrived at by removing the
 * hook rather than by declaring the boundary. `client-directive.test.ts`
 * enforces the rule that made the hook a liability in the first place.
 */

export interface MarkdownProps {
  children: string;
  className?: string;
}

function Runs({ runs, keyPrefix }: { runs: TextRun[]; keyPrefix: string }) {
  return (
    <>
      {runs.map((run, i) => {
        let node: React.ReactNode = run.text;
        // Innermost first, so the nesting matches the serializer's order.
        if (run.italic) node = <em>{node}</em>;
        if (run.bold) node = <strong>{node}</strong>;
        if (run.strike) node = <s>{node}</s>;
        if (run.link) {
          /*
           * A NEW TAB for the web, the same tab for mail. Somebody reading an
           * agreement is mid-task — often mid-checkout — and navigating them
           * away from it loses their place. A `mailto:` opens a mail client
           * and never navigates, so a new tab there would leave a blank one
           * behind.
           *
           * `rel` is set on both. `noopener` is what stops the opened page
           * reaching back through `window.opener`; `noreferrer` keeps the
           * booking URL, which is the only thing protecting a trip page, out
           * of a third party's referrer log.
           */
          const external = !run.link.startsWith("mailto:");
          node = (
            <a
              href={run.link}
              className="text-navy-800 underline underline-offset-2 hover:text-tag"
              {...(external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : { rel: "noopener noreferrer" })}
            >
              {node}
            </a>
          );
        }
        return <React.Fragment key={`${keyPrefix}-${i}`}>{node}</React.Fragment>;
      })}
    </>
  );
}

/**
 * Tables are the one block that can be wider than the column it sits in, and
 * an agreement is read at a measure on a phone. The scroll container is on
 * the wrapper, never on the page: a document that scrolls sideways as a whole
 * is unreadable, and one table that does is a table.
 */
function TableView({ block, index }: { block: TableBlock; index: number }) {
  const width = columnCount(block);
  const cells = (row: TextRun[][], prefix: string, Cell: "th" | "td") =>
    Array.from({ length: width }, (_, c) => (
      <Cell
        key={c}
        className={cn(
          "border border-border px-3 py-2 text-left align-top",
          Cell === "th" && "bg-muted/40 font-medium",
        )}
      >
        <Runs runs={row[c] ?? []} keyPrefix={`${prefix}-${c}`} />
      </Cell>
    ));

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>{cells(block.header, `t${index}-h`, "th")}</tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>{cells(row, `t${index}-${r}`, "td")}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockView({ block, index }: { block: Block; index: number }) {
  switch (block.kind) {
    case "rule":
      return <hr className="border-border" />;
    case "heading": {
      const runs = <Runs runs={block.content} keyPrefix={`h${index}`} />;
      // Sizes step down; the weight and the display face do not. An agreement
      // is a document, and its headings are structure rather than emphasis.
      if (block.level === 1) {
        return <h1 className="font-display text-lg font-semibold">{runs}</h1>;
      }
      return block.level === 2 ? (
        <h2 className="font-display text-base font-semibold">{runs}</h2>
      ) : (
        <h3 className="font-display text-sm font-semibold">{runs}</h3>
      );
    }
    case "paragraph":
      return (
        <p>
          <Runs runs={block.content} keyPrefix={`p${index}`} />
        </p>
      );
    case "blockquote":
      return (
        <blockquote className="border-l-2 border-border pl-4 text-muted-foreground">
          {block.content.map((line, j) => (
            <p key={j}>
              <Runs runs={line} keyPrefix={`q${index}-${j}`} />
            </p>
          ))}
        </blockquote>
      );
    case "table":
      return <TableView block={block} index={index} />;
    case "list": {
      const items = block.items.map((item, j) => (
        <li key={j}>
          <Runs runs={item} keyPrefix={`l${index}-${j}`} />
        </li>
      ));
      return block.list === "bullet" ? (
        <ul className="flex list-disc flex-col gap-1 pl-5">{items}</ul>
      ) : (
        <ol className="flex list-decimal flex-col gap-1 pl-5">{items}</ol>
      );
    }
  }
}

export function Markdown({ children, className }: MarkdownProps) {
  const blocks = parseAgreementMarkdown(children);

  return (
    <div className={cn("flex flex-col gap-3 text-sm leading-relaxed", className)}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} index={i} />
      ))}
    </div>
  );
}

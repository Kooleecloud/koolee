"use client";

/*
 * CLIENT COMPONENT: `useMemo` for the parsed AST. Today the only caller is already a client
 * component, so this never fired — but that made it a trap set for the first
 * server component to render an agreement body. Same failure as `avatar.tsx`.
 */

import * as React from "react";

import {
  parseAgreementMarkdown,
  type Block,
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
        return <React.Fragment key={`${keyPrefix}-${i}`}>{node}</React.Fragment>;
      })}
    </>
  );
}

function BlockView({ block, index }: { block: Block; index: number }) {
  switch (block.kind) {
    case "rule":
      return <hr className="border-border" />;
    case "heading":
      return block.level === 2 ? (
        <h2 className="font-display text-base font-semibold">
          <Runs runs={block.content} keyPrefix={`h${index}`} />
        </h2>
      ) : (
        <h3 className="font-display text-sm font-semibold">
          <Runs runs={block.content} keyPrefix={`h${index}`} />
        </h3>
      );
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
  const blocks = React.useMemo(() => parseAgreementMarkdown(children), [children]);

  return (
    <div className={cn("flex flex-col gap-3 text-sm leading-relaxed", className)}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} index={i} />
      ))}
    </div>
  );
}

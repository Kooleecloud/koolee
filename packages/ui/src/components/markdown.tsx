import * as React from "react";

import { cn } from "../lib/utils";

/**
 * A deliberately small Markdown renderer for operator-authored prose — today,
 * the booking agreement body.
 *
 * WHY NOT A LIBRARY. The one document this renders is written by an admin at
 * `/agreements` and read by customers and agents. Every general-purpose
 * renderer's escape hatch is raw HTML, and the safe way to use one is to turn
 * that off — at which point what remains is roughly this. Nothing here can
 * inject markup: it emits React elements only, never `dangerouslySetInnerHTML`,
 * so the worst a malformed document can do is look wrong.
 *
 * WHAT IT SUPPORTS: `##`/`###` headings, `---` rules, `-`/`*` bullet lists,
 * blank-line-separated paragraphs, and inline `**bold**` / `_italic_`.
 * Everything else renders as literal text — including links, which are
 * omitted on purpose: an agreement that can point somewhere else is an
 * agreement whose terms live somewhere we do not version.
 *
 * Line breaks inside a paragraph are soft (the seeded body is hard-wrapped at
 * 80 columns and must not render as one line per source line).
 */

export interface MarkdownProps {
  children: string;
  className?: string;
}

type Token =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "rule" }
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; text: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  // Normalize CRLF so a Windows-pasted document does not leave stray \r in
  // every heading and list marker.
  const blocks = source.replace(/\r\n/g, "\n").split(/\n{2,}/);

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    if (/^-{3,}$/.test(block)) {
      tokens.push({ kind: "rule" });
      continue;
    }

    const heading = /^(#{2,3})\s+(.*)$/.exec(block);
    if (heading) {
      tokens.push({
        kind: "heading",
        level: heading[1]!.length === 2 ? 2 : 3,
        text: heading[2]!.trim(),
      });
      continue;
    }

    const lines = block.split("\n");
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      tokens.push({
        kind: "list",
        items: lines.map((line) => line.replace(/^\s*[-*]\s+/, "").trim()),
      });
      continue;
    }

    tokens.push({ kind: "paragraph", text: lines.join(" ") });
  }
  return tokens;
}

/** `**bold**` and `_italic_`, as elements. Unmatched markers stay literal. */
function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|_([^_]+)_/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-b${index}`}>{match[1]}</strong>);
    } else {
      nodes.push(<em key={`${keyPrefix}-i${index}`}>{match[2]}</em>);
    }
    lastIndex = match.index + match[0].length;
    index += 1;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function Markdown({ children, className }: MarkdownProps) {
  const tokens = React.useMemo(() => tokenize(children), [children]);

  return (
    <div className={cn("flex flex-col gap-3 text-sm leading-relaxed", className)}>
      {tokens.map((token, i) => {
        switch (token.kind) {
          case "rule":
            return <hr key={i} className="border-border" />;
          case "heading":
            return token.level === 2 ? (
              <h2 key={i} className="font-display text-base font-semibold">
                {inline(token.text, `h${i}`)}
              </h2>
            ) : (
              <h3 key={i} className="font-display text-sm font-semibold">
                {inline(token.text, `h${i}`)}
              </h3>
            );
          case "list":
            return (
              <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
                {token.items.map((item, j) => (
                  <li key={j}>{inline(item, `l${i}-${j}`)}</li>
                ))}
              </ul>
            );
          case "paragraph":
            return <p key={i}>{inline(token.text, `p${i}`)}</p>;
        }
      })}
    </div>
  );
}

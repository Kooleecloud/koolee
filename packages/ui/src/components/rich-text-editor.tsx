"use client";

import * as React from "react";
import CharacterCount from "@tiptap/extension-character-count";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";

import {
  markdownToProseMirrorDoc,
  proseMirrorDocToMarkdown,
  type PmNode,
} from "../lib/agreement-markdown";
import { cn } from "../lib/utils";
import { Button } from "./button";

/**
 * Rich-text editor for agreement documents.
 *
 * THE EXTENSION LIST IS THE CONTRACT, not a starting point. Every node and
 * mark enabled below has a matching `Block` in `lib/agreement-markdown.ts` and
 * a matching branch in `<Markdown>`; anything else is disabled explicitly, so
 * an operator cannot author something the customer's trip page will silently
 * drop. If you enable something here, add it to the AST FIRST — the round-trip
 * tests will fail until you do, which is the intended order.
 *
 * WHAT IS OFF, AND WHY IT IS NOT AN OVERSIGHT
 *
 *  - `link` — an agreement whose terms live behind a link is an agreement
 *    whose terms are not versioned. Put related material in the page around
 *    the document.
 *  - `code`, `codeBlock` — monospace blocks make no sense in carriage terms.
 *  - `underline` — Markdown has no underline, and underlined prose reads as a
 *    broken link. Bold and italic cover the need.
 *  - Colour, highlight, alignment, font family — nothing good comes of a
 *    liability clause set in light grey.
 *  - Collapsible `details` sections — free in Tiptap since June 2026, and
 *    exactly wrong here: it lets someone accept terms with clauses collapsed
 *    out of sight.
 *  - Images, tables — not representable by the renderer today. Tables are the
 *    plausible future addition; they start in the AST, not here.
 *  - Nested lists — sinking is disabled below, because the AST is one level
 *    deep. Sub-clauses are a real need and the most likely next change.
 *
 * `Typography` IS on: it turns straight quotes into typographic ones and `--`
 * into an en dash. Those are plain characters, they survive the round trip
 * untouched, and a legal document should not be full of programmer quotes.
 */

export interface RichTextEditorProps {
  /** Markdown in. Treated as the initial document; not a controlled value. */
  value: string;
  /** Markdown out, on every change. */
  onChange: (markdown: string) => void;
  placeholder?: string;
  /** Read-only render of the editor chrome — used for previewing a version. */
  editable?: boolean;
  className?: string;
  "aria-label"?: string;
}

const TOOLBAR_BUTTON = "size-8 p-0";

function ToolbarButton({
  editor,
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  editor: Editor;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm"
      className={TOOLBAR_BUTTON}
      aria-label={label}
      aria-pressed={active ?? false}
      title={label}
      disabled={disabled ?? !editor.isEditable}
      // The editor loses focus to a toolbar button otherwise, which collapses
      // the selection the command is about to act on.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  editable = true,
  className,
  "aria-label": ariaLabel,
}: RichTextEditorProps) {
  // `onChange` is called from a Tiptap callback that is created once; a ref
  // keeps it current without tearing down and rebuilding the editor (which
  // would drop the selection on every keystroke).
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  /**
   * The last markdown THIS editor emitted.
   *
   * `onUpdate` → `onChange` → the parent's state → back in as `value`, so most
   * `value` changes are an echo of our own typing. This ref is how the adopt
   * effect below tells an echo from a genuine external change (loading a
   * different version into the editor).
   */
  const lastEmitted = React.useRef(value);

  const editor = useEditor({
    // The document is authored and rendered on the client; rendering it
    // during SSR would produce markup React then has to reconcile.
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // Explicitly off — see the note at the top of this file.
        link: false,
        code: false,
        codeBlock: false,
        underline: false,
      }),
      Typography,
      CharacterCount,
      ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    ],
    content: markdownToProseMirrorDoc(value),
    editorProps: {
      attributes: {
        class: cn(
          "prose-agreement min-h-64 max-w-none px-4 py-3 focus:outline-hidden",
          !editable && "opacity-90",
        ),
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
      },
      handleKeyDown(_view, event) {
        // Tab would sink a list item into a nested list, which the AST cannot
        // represent. Swallow it here rather than let the operator create
        // something that silently flattens on save.
        if (event.key === "Tab") {
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor: instance }) {
      const markdown = proseMirrorDocToMarkdown(instance.getJSON() as PmNode);
      lastEmitted.current = markdown;
      onChangeRef.current(markdown);
    },
  });

  /**
   * Adopt an externally-changed document — loading a different version into a
   * mounted editor.
   *
   * The bail-out compares against what WE last emitted, not against the
   * editor's current serialization, and that distinction is load-bearing:
   * Tiptap's `useEditor` hands back a fresh `editor` reference on every
   * transaction, so this effect re-runs on every keystroke. Re-serializing and
   * comparing there meant any normalisation difference (an underscore italic
   * becoming an asterisk, say) never converged — `setContent` fired, which is
   * itself a transaction, which re-ran the effect: "Maximum update depth
   * exceeded", a locked editor, and 200 console errors per edit.
   *
   * Against `lastEmitted` an echo is recognised in one reference comparison
   * and the editor is left alone.
   */
  React.useEffect(() => {
    if (!editor) return;
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(markdownToProseMirrorDoc(value) as never, {
      emitUpdate: false,
    });
  }, [editor, value]);

  React.useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  if (!editor) {
    return (
      <div
        className={cn(
          "min-h-64 animate-pulse rounded-md border border-input bg-muted/30",
          className,
        )}
      />
    );
  }

  const characters = editor.storage["characterCount"] as
    { characters: () => number; words: () => number } | undefined;

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-md border border-input bg-transparent shadow-xs focus-within:ring-2 focus-within:ring-ring",
        className,
      )}
    >
      {editable && (
        <div
          role="toolbar"
          aria-label="Formatting"
          className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5"
        >
          <ToolbarButton
            editor={editor}
            label="Heading 2"
            active={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            editor={editor}
            label="Heading 3"
            active={editor.isActive("heading", { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            <Heading3 className="size-4" />
          </ToolbarButton>

          <span aria-hidden className="mx-1 h-5 w-px bg-border" />

          <ToolbarButton
            editor={editor}
            label="Bold"
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            editor={editor}
            label="Italic"
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            editor={editor}
            label="Strikethrough"
            active={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className="size-4" />
          </ToolbarButton>

          <span aria-hidden className="mx-1 h-5 w-px bg-border" />

          <ToolbarButton
            editor={editor}
            label="Bulleted list"
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            editor={editor}
            label="Numbered list"
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            editor={editor}
            label="Quote"
            active={editor.isActive("blockquote")}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            editor={editor}
            label="Divider"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <Minus className="size-4" />
          </ToolbarButton>

          <span aria-hidden className="mx-1 h-5 w-px bg-border" />

          <ToolbarButton
            editor={editor}
            label="Undo"
            disabled={!editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            editor={editor}
            label="Redo"
            disabled={!editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 className="size-4" />
          </ToolbarButton>
        </div>
      )}

      <EditorContent editor={editor} />

      {editable && characters && (
        <div className="flex justify-end border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          {characters.words()} words · {characters.characters()} characters
        </div>
      )}
    </div>
  );
}

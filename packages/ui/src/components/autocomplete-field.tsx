"use client";

import * as React from "react";

import { cn } from "../lib/utils";
import { Input } from "./input";
import { Spinner } from "./spinner";

/**
 * A text input that offers suggestions while you type.
 *
 * Built for the funnel's address step and kept generic, because the thing that
 * varies between one typeahead and the next is WHERE the suggestions come
 * from, not how the list behaves. So this component owns exactly the parts
 * that are always the same — open/closed, which row is highlighted, the
 * keyboard contract, the ARIA wiring, dismissal — and owns none of the parts
 * that are always different: no fetching, no debounce, no caching, no minimum
 * length. The caller supplies `suggestions` and reacts to `onSelect`.
 *
 * WHY NOT `MultiSelect` OR `Select`. `Select` is a native `<select>` and
 * `MultiSelect` is a `<details>` disclosure over a checkbox list; both answer
 * "pick from a known set". A typeahead's set is not known — it changes with
 * every keystroke, arrives late, and may be empty — and its value is the TEXT,
 * with a suggestion being an optional shortcut. That is a different control,
 * which is why this is a new one rather than a prop on either of those.
 *
 * SUGGESTING IS NEVER GATING. The input is an ordinary controlled text field:
 * typing works, submitting works, and every downstream consumer sees the same
 * `name`/`value` it would have seen without this component. A suggestion list
 * that never loads costs the user nothing.
 *
 * Dismissal follows `MultiSelect`: outside pointerdown and Escape, because
 * nothing in the platform closes a floating list for you.
 */

export interface AutocompleteSuggestion {
  /** Stable across renders — the option's identity, not its position. */
  id: string;
  /** The primary line, and what a screen reader announces. */
  label: string;
  /** A dimmer second line — a city and state, a category, a count. */
  hint?: string;
}

export interface AutocompleteFieldProps extends Omit<
  React.ComponentProps<"input">,
  "onSelect" | "value" | "onChange"
> {
  value: string;
  /** Every keystroke, and every accepted suggestion's `label`. */
  onValueChange: (next: string) => void;
  suggestions: AutocompleteSuggestion[];
  onSelect: (suggestion: AutocompleteSuggestion) => void;
  /** A request is in flight. Renders a spinner in the field, never a blocker. */
  loading?: boolean;
  /** Shown in place of the list when a settled search found nothing. */
  emptyMessage?: React.ReactNode;
  /** True when a search has settled with no results — pairs with `emptyMessage`. */
  showEmpty?: boolean;
  /** Wrapper class. Use `className` for the input itself. */
  wrapperClassName?: string;
}

function AutocompleteField({
  value,
  onValueChange,
  suggestions,
  onSelect,
  loading = false,
  emptyMessage,
  showEmpty = false,
  className,
  wrapperClassName,
  id,
  ...props
}: AutocompleteFieldProps) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  const listId = `${id ?? "autocomplete"}-listbox`;
  const hasList = suggestions.length > 0;
  const expanded = open && (hasList || showEmpty);

  /*
   * A new set of suggestions is a new list, so the highlight resets — keeping
   * it would point at whatever now happens to sit at that index.
   *
   * Keyed on the IDS, not on the array's identity, and adjusted during render
   * rather than in an effect. Both details are load-bearing. A caller that
   * builds `suggestions` with a `.map` inline (which is the natural way to
   * write one) hands over a new array every render; an identity comparison
   * would then reset the highlight on every render and the arrow keys would
   * silently do nothing. And `setState` inside an effect is a cascading
   * render, which the lint rule correctly refuses — React supports adjusting
   * state during render for exactly this case.
   */
  const suggestionKey = suggestions.map((suggestion) => suggestion.id).join("\u0000");
  const [lastKey, setLastKey] = React.useState(suggestionKey);
  if (lastKey !== suggestionKey) {
    setLastKey(suggestionKey);
    setActive(-1);
  }

  React.useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [expanded]);

  const accept = (suggestion: AutocompleteSuggestion) => {
    onSelect(suggestion);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!hasList) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => {
        const next = current + step;
        // Wraps, so ArrowUp from the field lands on the last suggestion —
        // the behaviour every native listbox has.
        if (next < 0) return suggestions.length - 1;
        if (next >= suggestions.length) return 0;
        return next;
      });
      return;
    }

    if (event.key === "Enter" && active >= 0) {
      // Only when a row is highlighted: Enter with nothing chosen must still
      // submit the form, because a hand-typed address is a complete answer.
      const suggestion = suggestions[active];
      if (suggestion) {
        event.preventDefault();
        accept(suggestion);
      }
    }
  };

  return (
    <div ref={wrapperRef} className={cn("relative", wrapperClassName)}>
      <Input
        {...props}
        id={id}
        value={value}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          active >= 0 && suggestions[active] ? `${listId}-${active}` : undefined
        }
        // The browser's own address autofill would draw a second list over
        // this one. Callers that want it can pass `autoComplete` explicitly.
        autoComplete={props.autoComplete ?? "off"}
        className={cn(loading && "pr-9", className)}
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
        }}
        onFocus={(event) => {
          if (suggestions.length > 0) setOpen(true);
          props.onFocus?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown(event);
          props.onKeyDown?.(event);
        }}
      />

      {loading ? (
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">
          <Spinner className="size-4 text-muted-foreground" label="Looking for matches" />
        </span>
      ) : null}

      {expanded ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-white py-1 shadow-lg"
        >
          {hasList ? (
            suggestions.map((suggestion, index) => (
              <li
                key={suggestion.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                // pointerdown, not click: the input's blur would close the
                // list before a click ever landed.
                onPointerDown={(event) => {
                  event.preventDefault();
                  accept(suggestion);
                }}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "cursor-pointer px-3 py-2 text-sm",
                  index === active ? "bg-accent/15 text-navy-800" : "text-navy-800",
                )}
              >
                <span className="block truncate font-medium">{suggestion.label}</span>
                {suggestion.hint ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {suggestion.hint}
                  </span>
                ) : null}
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

export { AutocompleteField };

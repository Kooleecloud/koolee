"use client";

import * as React from "react";
import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, CheckboxField, Input, MultiSelect, Spinner } from "@koolee/ui";

/**
 * The bookings board's filter bar.
 *
 * Filters live in the URL, not in component state: a board an operator is
 * looking at should be a link they can send to whoever is covering next. This
 * component only translates ticks into query params and pushes — the server
 * page is what reads them and queries.
 *
 * Multi-value params are comma-separated (`?status=paid,exception`) rather
 * than repeated keys, because they read as something a human would type.
 */

/**
 * How long the typing has to stop before a search runs.
 *
 * The bar used to submit on ENTER only, and the note here argued for it: an
 * operator is typing an identifier they already have, and a query per
 * keystroke would fire ten searches to find one booking. That objection is
 * right and it is answered by the pair below rather than by the Enter key —
 * which had its own cost, since nothing on screen said Enter was required and
 * a half-typed ref simply sat there returning the unfiltered board.
 */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Below this, searching is not attempted at all.
 *
 * Every term this box accepts is an identifier: a `KOO-XXXXX` ref, a phone
 * number, a seal serial. One or two characters cannot narrow any of them to
 * something worth reading — it would match most of the board and look like the
 * filter is broken. The placeholder says so, so an operator watching nothing
 * happen knows why.
 */
const SEARCH_MIN_LENGTH = 3;

export interface BoardFilterOption {
  value: string;
  label: string;
  hint?: string;
}

export function BoardFilters({
  statusOptions,
  airportOptions,
  statuses,
  airports,
  today,
  search,
}: {
  statusOptions: BoardFilterOption[];
  airportOptions: BoardFilterOption[];
  statuses: string[];
  airports: string[];
  today: boolean;
  search: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const push = (patch: Record<string, string | string[] | boolean>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      const encoded = Array.isArray(value)
        ? value.join(",")
        : typeof value === "string"
          ? value.trim()
          : value
            ? "1"
            : "";
      if (encoded) next.set(key, encoded);
      else next.delete(key);
    }
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };

  /*
   * NO STATE FOR THE TERM, and that is the point.
   *
   * The obvious version holds the text in `useState` and re-seeds it from the
   * URL in an effect. That sets state inside an effect — a cascading render,
   * which the lint rule correctly refuses — and it buys nothing: the input can
   * hold its own text.
   *
   * The debounce is therefore a timer in a ref, and every read is
   * `event.target.value` rather than anything closed over. A handler reading a
   * captured value here would search for the PREVIOUS keystroke, which is the
   * bug this codebase has already paid for once.
   */
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  /*
   * THE TERM THIS BAR ITSELF ASKED FOR, so it can tell its own navigation from
   * somebody else's.
   *
   * This box used to carry `key={search}`, which re-seeded it by REMOUNTING it
   * whenever the URL's term changed. That is correct for a Reset or a pasted
   * link and wrong for the ordinary case: the search a person is typing also
   * changes the URL, so the input was destroyed and rebuilt 300ms after they
   * stopped — taking the focus and the caret with it. Every operator refining
   * a term had to click back into the box to keep typing.
   *
   * A ref instead of state: comparing here decides whether to touch the DOM,
   * and it must not itself cause a render.
   */
  const requested = React.useRef(search);

  const runSearch = (next: string) => {
    const trimmed = next.trim();
    // Under the minimum is "no search", not "search for two characters", so
    // backspacing to one letter restores the full board rather than leaving it
    // filtered by a fragment.
    const term = trimmed.length >= SEARCH_MIN_LENGTH ? trimmed : "";
    requested.current = term;
    push({ q: term });
  };

  /*
   * Re-seed the box only when the term arrived from OUTSIDE this bar — Reset,
   * a pasted link, the browser's back button. Writing to the DOM node keeps
   * the element alive, which is the whole difference from `key`: focus and
   * caret survive.
   *
   * Note what is deliberately NOT re-seeded. Typing "ce" pushes `q=""`,
   * because two characters is below the minimum — so the URL says "" while the
   * box says "ce", and `requested` says "" too. They agree, nothing is
   * written, and the half-typed term stays where the operator put it.
   */
  React.useEffect(() => {
    if (search === requested.current) return;
    requested.current = search;
    const input = inputRef.current;
    if (input && input.value !== search) input.value = search;
  }, [search]);

  const onSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(value), SEARCH_DEBOUNCE_MS);
  };

  // A pending search must not fire after the bar has gone.
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const filtered = statuses.length > 0 || airports.length > 0 || today || search !== "";

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <form
        onSubmit={(event) => {
          // Enter still works and skips the wait. Somebody who has finished
          // typing should not sit through a debounce they cannot see.
          event.preventDefault();
          if (timer.current) clearTimeout(timer.current);
          const value = new FormData(event.currentTarget).get("q");
          runSearch(typeof value === "string" ? value : "");
        }}
      >
        <Input
          ref={inputRef}
          name="q"
          type="search"
          defaultValue={search}
          onChange={onSearchChange}
          placeholder={`Ref, name, flight, phone… (${SEARCH_MIN_LENGTH}+ characters)`}
          aria-label={`Search bookings by ref, passenger or customer name, email, flight number, phone, seal serial, driver, truck or agent. At least ${SEARCH_MIN_LENGTH} characters.`}
          className="w-72"
        />
      </form>
      <MultiSelect
        label="Status"
        allLabel="All statuses"
        options={statusOptions}
        selected={statuses}
        onChange={(next) => push({ status: next })}
        className="w-60"
        summarize={(selected) => `${selected.length} statuses`}
      />
      <MultiSelect
        label="Airport"
        allLabel="All airports"
        options={airportOptions}
        selected={airports}
        onChange={(next) => push({ airport: next })}
        className="w-56"
        summarize={(selected) => selected.join(", ")}
      />
      <CheckboxField
        label="Today's pickups only"
        checked={today}
        onChange={(event) => push({ today: event.target.checked })}
      />
      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => push({ status: [], airport: [], today: false, q: "" })}
        >
          Reset
        </Button>
      )}
      {pending && <Spinner className="size-4 text-muted-foreground" label="Filtering" />}
    </div>
  );
}

"use client";

import * as React from "react";
import { AutocompleteField, type AutocompleteSuggestion } from "@koolee/ui";

/**
 * The address step's street field, wired to Places through the server proxy.
 *
 * The LIST behaviour — open/closed, arrow keys, ARIA, dismissal — belongs to
 * `AutocompleteField` in `@koolee/ui`. What lives here is the part that is
 * specific to this field: debouncing, the Places session token, the fetch, and
 * turning a chosen suggestion into the five structured fields the form
 * already has.
 *
 * ASSIST, NEVER GATE. Every failure path — no key in this environment (the
 * route answers `204`), a network error, a suggestion whose details come back
 * incomplete — leaves the customer with exactly the text input they had
 * before, and the form submits it. Nothing about the address step depends on
 * Google being up.
 *
 * NOTHING IS SEARCHED UNTIL SOMEBODY TYPES. The field is frequently mounted
 * with a value already in it, and searching on mount billed a Places call per
 * mount — ten expands of one saved address was ten identical billed
 * autocompletes nobody saw. See `hasTyped`.
 *
 * SESSION TOKENS. One token per typing session, minted here, sent with every
 * suggest call and with the details call that ends it, then thrown away.
 * Google bills that as one autocomplete plus one details request; without a
 * token it would bill every keystroke separately. A new token is minted after
 * each selection because the session is over.
 */

/** Long enough that a fast typist makes one request, short enough to feel live. */
const DEBOUNCE_MS = 250;
/** Matches the server's floor — below this nothing is sent at all. */
const MIN_CHARS = 3;

export interface SelectedPlace {
  line1: string;
  city: string;
  state: string;
  zip: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
}

interface PlacesSuggestion {
  placeId: string;
  description: string;
  mainText?: string;
  secondaryText?: string;
}

function newSessionToken(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AddressAutocomplete({
  id,
  name,
  value,
  onValueChange,
  onPlaceSelected,
  ...props
}: {
  id: string;
  name: string;
  value: string;
  /** A hand edit. The caller uses this to clear any coordinates it holds. */
  onValueChange: (next: string) => void;
  /** A chosen suggestion, resolved to structured fields. */
  onPlaceSelected: (place: SelectedPlace) => void;
} & Omit<
  React.ComponentProps<"input">,
  "id" | "name" | "value" | "onChange" | "onSelect"
>) {
  /**
   * The last settled answer AND the query it answers.
   *
   * They are one piece of state on purpose. Keeping a bare list would mean
   * showing the previous address's suggestions for the moment between a
   * keystroke and its response — and it would force a synchronous `setState`
   * inside the effect to clear them, which is a cascading render the lint rule
   * refuses. Comparing the stored query with the current one answers both
   * "what should be visible" and "did a search settle with nothing" for free.
   */
  const [result, setResult] = React.useState<{
    query: string;
    items: PlacesSuggestion[];
  }>({ query: "", items: [] });
  const [loading, setLoading] = React.useState(false);
  const sessionToken = React.useRef(newSessionToken());
  // Bumped on every keystroke and on selection, so a slow response for text
  // the customer has already typed past is dropped rather than rendered.
  const requestSeq = React.useRef(0);
  // Set immediately after a selection so the resulting value change does not
  // fire a fresh search for the text we just filled in.
  const justSelected = React.useRef(false);
  /**
   * Has a HUMAN typed in this field yet?
   *
   * Nothing is searched until they have, and that is a billing rule, not a
   * nicety. The field is often mounted with a value already in it — the saved
   * address inside an accordion row, the funnel's pickup step when somebody
   * steps back to edit — and the effect below keys on the query, so mounting
   * with three or more characters fired a Places autocomplete for text nobody
   * had entered. Expanding and collapsing one saved address ten times was ten
   * billed calls for ten identical suggestions the customer never asked for
   * and never saw.
   *
   * A ref rather than state: it must not cause a render, and the effect reads
   * it at the moment it runs rather than closing over a stale value.
   */
  const hasTyped = React.useRef(false);

  const query = value.trim();
  const searchable = query.length >= MIN_CHARS;
  const settled = result.query === query;

  React.useEffect(() => {
    if (justSelected.current) {
      justSelected.current = false;
      return;
    }
    // A value that arrived as a default is not a search. See `hasTyped`.
    if (!hasTyped.current) return;
    if (!searchable) return;

    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      setLoading(true);
      void (async () => {
        try {
          const response = await fetch("/api/places", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "suggest",
              input: query,
              sessionToken: sessionToken.current,
            }),
          });
          if (seq !== requestSeq.current) return;
          // 204 means this environment has no Maps key. Not an error, and not
          // worth a console line on every keystroke.
          if (!response.ok || response.status === 204) return;

          const body = (await response.json()) as { suggestions?: PlacesSuggestion[] };
          if (seq !== requestSeq.current) return;
          setResult({ query, items: body.suggestions ?? [] });
        } catch {
          // Suggesting never gates. The field still holds what was typed.
        } finally {
          if (seq === requestSeq.current) setLoading(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, searchable]);

  /*
   * Memoized so the list handed down is stable between renders — see the
   * identity note in `AutocompleteField`: a fresh array every render would
   * reset the highlight and the arrow keys would silently do nothing.
   *
   * The "does this answer belong to what is typed" test is INSIDE the memo,
   * so its dependencies are two primitives rather than a derived array.
   */
  const options: AutocompleteSuggestion[] = React.useMemo(
    () =>
      result.query !== query
        ? []
        : result.items.map((suggestion) => ({
            id: suggestion.placeId,
            label: suggestion.mainText ?? suggestion.description,
            ...(suggestion.secondaryText === undefined
              ? {}
              : { hint: suggestion.secondaryText }),
          })),
    [result, query],
  );

  const onSelect = (option: AutocompleteSuggestion) => {
    justSelected.current = true;
    requestSeq.current += 1;
    // The list is keyed to the query it answers, so pinning it to the chosen
    // text closes it without a second piece of state.
    setResult({ query: option.label.trim(), items: [] });
    // Optimistic: the street line goes in immediately, and the details call
    // fills the rest a moment later. A details call that fails leaves the
    // customer with a correct street line and three fields to finish, which
    // is where they would have been anyway.
    onValueChange(option.label);

    const token = sessionToken.current;
    // The session ended with this selection; the next keystroke starts a new
    // one, which is exactly how Places prices it.
    sessionToken.current = newSessionToken();

    void (async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/places", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "details",
            placeId: option.id,
            sessionToken: token,
          }),
        });
        if (!response.ok || response.status === 204) return;
        const body = (await response.json()) as {
          address?: {
            line1: string;
            city: string;
            state: string;
            zip: string;
            placeId: string;
            coordinates: { lat: number; lng: number } | null;
          } | null;
        };
        const address = body.address;
        if (!address) return;

        justSelected.current = true;
        onPlaceSelected({
          line1: address.line1,
          city: address.city,
          state: address.state,
          zip: address.zip,
          placeId: address.placeId,
          lat: address.coordinates?.lat ?? null,
          lng: address.coordinates?.lng ?? null,
        });
      } catch {
        // Silent by design: the street line is already filled in.
      } finally {
        setLoading(false);
      }
    })();
  };

  /**
   * The only thing that marks this field as typed-in.
   *
   * `AutocompleteField` calls this from a real input event, so it cannot fire
   * for a mounted default. `onSelect` also calls the caller's handler, but the
   * `justSelected` guard above already stops that from searching.
   */
  const onTyped = (next: string) => {
    hasTyped.current = true;
    onValueChange(next);
  };

  return (
    <AutocompleteField
      {...props}
      id={id}
      name={name}
      value={value}
      onValueChange={onTyped}
      suggestions={options}
      onSelect={onSelect}
      loading={loading}
      showEmpty={searchable && settled && result.items.length === 0}
      emptyMessage="No matches — type the address in full and we will take it from there."
    />
  );
}

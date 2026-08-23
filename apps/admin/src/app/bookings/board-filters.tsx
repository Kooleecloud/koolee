"use client";

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

  const filtered = statuses.length > 0 || airports.length > 0 || today || search !== "";

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {/* Submit-on-enter rather than search-as-you-type: an operator is
          typing an identifier they already have, and a keystroke-per-query
          board would fire ten searches to find one booking. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("q");
          push({ q: typeof value === "string" ? value : "" });
        }}
      >
        <Input
          key={search}
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Ref, phone, or seal"
          aria-label="Search by booking ref, phone number, or seal serial"
          className="w-56"
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

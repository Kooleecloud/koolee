"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckboxField, Select, Spinner } from "@koolee/ui";

/**
 * Airport and verified-state filters for the cutoff matrix.
 *
 * Same convention as the bookings board: filters live in the URL, not in
 * component state, so what an operator is looking at is a link they can send
 * to whoever is verifying the rest. This component only translates a choice
 * into query params; the server page reads them and queries.
 *
 * It exists because 128 rows is more than a page: "the JFK ones I have not
 * done yet" is the actual unit of work, and without a filter the answer is
 * scrolling.
 */
export function CutoffFilters({
  airport,
  unverifiedOnly,
}: {
  airport: string;
  unverifiedOnly: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const push = (patch: Record<string, string | boolean>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      const encoded = typeof value === "string" ? value.trim() : value ? "1" : "";
      if (encoded) next.set(key, encoded);
      else next.delete(key);
    }
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Airport</span>
        <Select
          className="w-28"
          value={airport}
          onChange={(event) => push({ airport: event.target.value })}
        >
          <option value="">All</option>
          <option value="JFK">JFK</option>
          <option value="LGA">LGA</option>
          <option value="EWR">EWR</option>
        </Select>
      </label>

      <CheckboxField
        label="Unverified only"
        checked={unverifiedOnly}
        onChange={(event) => push({ unverified: event.target.checked })}
      />

      {pending ? <Spinner className="size-4 text-muted-foreground" /> : null}
    </div>
  );
}

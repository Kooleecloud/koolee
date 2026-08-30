"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { Button, Input, Label } from "@koolee/ui";

/**
 * The date range for one person's work history.
 *
 * A GET form onto the same route rather than client state: the range is in the
 * URL, so a link to "what Nina did in June" is a link somebody can paste into
 * a ticket. That is the whole reason this is not a dropdown with local state.
 *
 * Bounds are UTC days, and the page says so. A staff record belongs to no
 * booking, so there is no airport zone to interpret an operator's typed date
 * in — and a range filter that silently shifted by five hours would be worse
 * than one that is plainly UTC.
 */
export function DateRangeFilter({
  userId,
  from,
  to,
}: {
  userId: string;
  from: string;
  to: string;
}) {
  const router = useRouter();

  return (
    <form
      action={`/staff/${userId}`}
      method="get"
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="from" className="text-xs">
          From (UTC)
        </Label>
        <Input id="from" name="from" type="date" defaultValue={from} className="w-40" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="to" className="text-xs">
          To (UTC)
        </Label>
        <Input id="to" name="to" type="date" defaultValue={to} className="w-40" />
      </div>
      <Button type="submit" variant="outline">
        Apply
      </Button>
      {(from || to) && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(`/staff/${userId}`)}
        >
          Clear
        </Button>
      )}
    </form>
  );
}

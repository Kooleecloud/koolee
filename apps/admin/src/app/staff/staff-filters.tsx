"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckboxField, SegmentedControl, Spinner } from "@koolee/ui";

/**
 * Two narrowings on the roster, in the URL.
 *
 * IN THE URL rather than in state, like the bookings board's filter bar: a
 * roster somebody is looking at should be a link they can send to whoever is
 * covering next, and it keeps the page itself a server component with nothing
 * to synchronise.
 *
 * THE TWO ARE DIFFERENT SHAPES ON PURPOSE. "Active / everyone" is a choice
 * between two views of the same list, so it is a segmented control — the same
 * one the agent app and the customer's driver map use. "Can drive" is an
 * additional narrowing you either apply or do not, which is a checkbox. A
 * third tab reading "can drive" would imply it were exclusive with the other
 * two, and it is not.
 *
 * DEFAULT IS ACTIVE ONLY. A deactivated person is a record, not a colleague:
 * they cannot be assigned, cannot sign in, and on a roster read to answer "who
 * can I send" they are noise. The count beside the control says how many are
 * being held back, so the default never hides anything silently.
 */
export function StaffFilters({
  drivingOnly,
  showing,
  counts,
}: {
  drivingOnly: boolean;
  showing: "active" | "all";
  counts: { shown: number; total: number };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const push = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };

  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <SegmentedControl
        items={[
          { value: "active" as const, label: "Active" },
          { value: "all" as const, label: "Everyone" },
        ]}
        value={showing}
        onChange={(next) => push({ show: next === "all" ? "all" : "" })}
        label="Active staff or everyone"
        className="sm:max-w-52"
      />
      <CheckboxField
        label="Can drive"
        checked={drivingOnly}
        onChange={(event) => push({ driving: event.target.checked ? "1" : "" })}
      />
      <span className="text-xs text-muted-foreground">
        Showing {counts.shown} of {counts.total}
      </span>
      {pending && <Spinner className="size-4 text-muted-foreground" label="Filtering" />}
    </div>
  );
}

import Link from "next/link";
import { Camera, Mail, Phone, UserRound } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@koolee/ui";
import type { ProfileGap } from "@koolee/core";

/**
 * "Finish your profile" — shown ONLY when there is something to finish.
 *
 * A checklist that is permanently visible and permanently satisfied is
 * furniture; people stop reading it, and then it cannot do its one job. So the
 * card renders nothing at all when the profile is complete, and it lists
 * EXACTLY what is missing rather than four rows with ticks on three.
 *
 * Every item is a link to the control that fixes it, because a checklist that
 * names a problem and leaves you to find the form is a worse version of no
 * checklist.
 *
 * WHAT IS NOT IN HERE: accepting the booking agreement and pre-uploading a
 * passport. Those are per-BOOKING (see services/profile-completeness.ts), they
 * would un-complete a finished profile every time somebody books, and they are
 * prompted on the trip that needs them.
 */

const ITEMS: Record<
  ProfileGap,
  { icon: typeof Phone; title: string; detail: string; href: string; cta: string }
> = {
  verify_phone: {
    icon: Phone,
    title: "Verify your phone number",
    detail: "It's how your driver reaches you if they can't find the door.",
    href: "/dashboard/profile",
    cta: "Verify",
  },
  verify_email: {
    icon: Mail,
    title: "Verify your email",
    detail: "Where your booking confirmations and seal numbers go.",
    href: "/dashboard/profile",
    cta: "Verify",
  },
  add_name: {
    icon: UserRound,
    title: "Add your name",
    detail: "So your agent can greet you rather than a booking reference.",
    href: "/dashboard/profile",
    cta: "Add",
  },
  add_photo: {
    icon: Camera,
    title: "Add a profile photo",
    detail: "Your agent sees it before they knock, and you see theirs.",
    href: "/dashboard/profile",
    cta: "Add",
  },
};

export function ProfileCompletenessCard({ missing }: { missing: readonly ProfileGap[] }) {
  if (missing.length === 0) return null;

  return (
    <Card className="border-sky-200 bg-sky-50/50">
      <CardHeader>
        <CardTitle className="font-display text-base">Finish setting up</CardTitle>
        <CardDescription>
          {missing.length === 1
            ? "One thing left, and it takes a moment."
            : `${missing.length} things left, and they take a moment.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-sky-200/70">
          {missing.map((gap) => {
            const item = ITEMS[gap];
            const Icon = item.icon;
            return (
              <li key={gap} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <Icon aria-hidden="true" className="size-4 shrink-0 text-sky-700" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-navy-800">{item.title}</span>
                  <span className="text-sm text-muted-foreground">{item.detail}</span>
                </span>
                <Link
                  href={item.href}
                  className="ml-auto shrink-0 text-sm font-medium text-sky-700 underline underline-offset-4 hover:text-sky-600"
                >
                  {item.cta}
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

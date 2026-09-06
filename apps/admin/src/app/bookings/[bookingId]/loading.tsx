import { PageSkeleton } from "@koolee/ui";

import { ConsoleMain } from "@/components/console";

export default function BookingDetailLoading() {
  return (
    <ConsoleMain>
      <PageSkeleton cards={4} />
    </ConsoleMain>
  );
}

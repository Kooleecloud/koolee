import { PageSkeleton } from "@koolee/ui";

import { ConsoleMain } from "@/components/console";

export default function ExceptionsLoading() {
  return (
    <ConsoleMain>
      <PageSkeleton cards={3} />
    </ConsoleMain>
  );
}

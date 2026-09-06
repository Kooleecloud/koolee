import { PageSkeleton } from "@koolee/ui";

import { ConsoleMain } from "@/components/console";

export default function AdminLoading() {
  return (
    <ConsoleMain>
      <PageSkeleton cards={3} />
    </ConsoleMain>
  );
}

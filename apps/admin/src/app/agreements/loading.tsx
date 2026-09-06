import { PageSkeleton } from "@koolee/ui";

import { ConsoleMain } from "@/components/console";

export default function AgreementsLoading() {
  return (
    <ConsoleMain>
      <PageSkeleton cards={2} />
    </ConsoleMain>
  );
}

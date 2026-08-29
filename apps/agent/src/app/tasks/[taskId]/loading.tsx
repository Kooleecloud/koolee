import { PageSkeleton } from "@koolee/ui";

import { AgentMain } from "@/components/shell/agent-main";

export default function VisitLoading() {
  return (
    <AgentMain>
      <PageSkeleton cards={3} />
    </AgentMain>
  );
}

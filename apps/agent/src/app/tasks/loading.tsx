import { PageSkeleton } from "@koolee/ui";

import { AgentMain } from "@/components/shell/agent-main";

export default function ScheduleLoading() {
  return (
    <AgentMain>
      <PageSkeleton cards={4} />
    </AgentMain>
  );
}

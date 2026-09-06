import { PageSkeleton } from "@koolee/ui";

import { AgentMain } from "@/components/shell/agent-main";

export default function AccountLoading() {
  return (
    <AgentMain>
      <PageSkeleton cards={2} />
    </AgentMain>
  );
}

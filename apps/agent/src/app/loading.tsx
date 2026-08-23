import { ContentColumn, PageSkeleton } from "@koolee/ui";

export default function AgentLoading() {
  return (
    <ContentColumn>
      <PageSkeleton cards={2} />
    </ContentColumn>
  );
}

import { ContentColumn, PageSkeleton } from "@koolee/ui";

export default function AgentLoading() {
  return (
    <ContentColumn width="narrow">
      <PageSkeleton cards={2} />
    </ContentColumn>
  );
}

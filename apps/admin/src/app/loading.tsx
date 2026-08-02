import { ContentColumn, PageSkeleton } from "@koolee/ui";

export default function AdminLoading() {
  return (
    <ContentColumn>
      <PageSkeleton cards={2} />
    </ContentColumn>
  );
}

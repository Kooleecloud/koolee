import Link from "next/link";
import { BackLink, ContentColumn, PageHeader } from "@koolee/ui";

import { CameraCapture } from "@/components/camera-capture";

export const metadata = { title: "Scan" };

export default function ScanPage() {
  return (
    <ContentColumn width="narrow">
      <BackLink href="/tasks" linkComponent={Link} className="self-start">
        Back
      </BackLink>

      <PageHeader title="Scan" />

      <CameraCapture />
    </ContentColumn>
  );
}

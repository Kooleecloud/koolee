import Link from "next/link";
import { redirect } from "next/navigation";
import { BackLink, ContentColumn, PageHeader } from "@koolee/ui";

import { CameraCapture } from "@/components/camera-capture";
import { getAgentSession } from "@/lib/session";

export const metadata = { title: "Scan" };
export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const session = await getAgentSession();
  if (!session) redirect("/login");

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

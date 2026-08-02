import { PageHeader } from "@koolee/ui";

import { ZipStepForm } from "@/components/zip-step-form";
import { readDraft } from "@/lib/booking-draft";

export const metadata = { title: "Where are your bags?" };
export const dynamic = "force-dynamic";

export default async function ZipStepPage() {
  const draft = await readDraft();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Where are your bags?"
        subtitle={<>Enter your pickup ZIP and we&apos;ll confirm we can collect there.</>}
      />

      <ZipStepForm defaultZip={draft.zip ?? ""} />
    </div>
  );
}

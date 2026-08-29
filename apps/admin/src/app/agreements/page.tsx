import { redirect } from "next/navigation";
import { ContentColumn, DatabaseNotConfigured, PageHeader } from "@koolee/ui";
import {
  getCurrentAgreementVersion,
  isAgreementVersionEditable,
  listAgreementVersions,
} from "@koolee/core";

import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

import { AgreementsWorkbench, type AgreementVersionView } from "./agreements-workbench";

export const metadata = { title: "Agreements" };
export const dynamic = "force-dynamic";

/**
 * Versioned booking agreements.
 *
 * "Current" is DERIVED — `max(version)` among rows whose `effective_from` has
 * passed — so this page MARKS the current row rather than offering a
 * make-current control. There is nothing to toggle; publishing a newer version
 * is the only way to change what is in force, and that is the point (see the
 * note in `packages/core/src/services/agreements.ts`).
 *
 * Times render in UTC and always carry the suffix. An agreement version
 * belongs to no booking, so docs/TIME.md's "the booking's zone" has nothing to
 * point at here — and UTC matches the editor's UTC input, so an operator reads
 * back exactly what they typed. The customer sees the same instant in their own
 * booking's zone on their trip page.
 */
export default async function AgreementsPage() {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const core = tryGetCore();
  let versions: AgreementVersionView[] = [];
  let unavailable = core === null;

  if (core) {
    try {
      const now = new Date();
      const [rows, current] = await Promise.all([
        listAgreementVersions(core.db),
        getCurrentAgreementVersion(core.db, now),
      ]);
      versions = rows.map((version) => ({
        id: version.id,
        version: version.version,
        title: version.title,
        bodyMd: version.bodyMd,
        effectiveFromIso: version.effectiveFrom.toISOString(),
        createdAtIso: version.createdAt.toISOString(),
        scheduled: isAgreementVersionEditable(version, now),
        current: version.id === current?.id,
      }));
    } catch {
      unavailable = true;
    }
  }

  return (
    <ContentColumn>
      <PageHeader
        title="Booking agreements"
        subtitle={
          unavailable
            ? "Database not configured."
            : `${versions.length} version${versions.length === 1 ? "" : "s"}`
        }
      />

      {unavailable ? (
        <DatabaseNotConfigured />
      ) : (
        <AgreementsWorkbench versions={versions} />
      )}
    </ContentColumn>
  );
}

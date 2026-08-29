import { redirect } from "next/navigation";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ContentColumn,
  DatabaseNotConfigured,
  EmptyState,
  Markdown,
  PageHeader,
} from "@koolee/ui";
import {
  countBookingsNeedingReacceptance,
  formatInstantInAirportTz,
  getCurrentAgreementVersion,
  listAgreementVersions,
  type AgreementVersion,
} from "@koolee/core";

import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

import { PublishAgreementForm } from "./publish-form";

export const metadata = { title: "Agreements" };
export const dynamic = "force-dynamic";

/**
 * The zone this page renders in.
 *
 * docs/TIME.md's rule is "the BOOKING's zone", and an agreement version
 * belongs to no booking — there is no such zone to use here. UTC through the
 * sanctioned formatter (which appends the abbreviation, so nothing is ever
 * unlabelled) is the honest answer, and it matches the publish form's UTC
 * input so an operator reads back exactly what they typed. The customer never
 * sees this instant in UTC: their trip page renders it in their booking's zone.
 */
const AGREEMENT_DISPLAY_TZ = "UTC";

/**
 * Versioned booking agreements.
 *
 * "Current" is DERIVED — `max(version)` among rows whose `effective_from` has
 * passed — so this page marks the current row rather than offering a
 * make-current control. There is nothing to toggle; publishing a newer
 * version is the only way to change what is in force, and that is the point
 * (see the note in `packages/core/src/services/agreements.ts`).
 */
export default async function AgreementsPage() {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const core = tryGetCore();
  let versions: AgreementVersion[] = [];
  let currentId: string | null = null;
  let affected = 0;
  let unavailable = core === null;

  if (core) {
    try {
      const [rows, current, count] = await Promise.all([
        listAgreementVersions(core.db),
        getCurrentAgreementVersion(core.db, new Date()),
        countBookingsNeedingReacceptance(core.db),
      ]);
      versions = rows;
      currentId = current?.id ?? null;
      affected = count;
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
            : `${versions.length} version${versions.length === 1 ? "" : "s"} · ${affected} booking${affected === 1 ? "" : "s"} in flight`
        }
      />

      {unavailable ? (
        <DatabaseNotConfigured />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
          <section className="flex flex-col gap-3">
            {versions.length === 0 ? (
              <EmptyState
                title="No agreement published"
                description="Until one exists, no visit can proceed past the identity step — the gate fails closed on purpose. Publish the first version here."
              />
            ) : (
              versions.map((version) => (
                <Card key={version.id}>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                      <span>
                        v{version.version} · {version.title}
                      </span>
                      {version.id === currentId ? (
                        <Badge variant="success">current</Badge>
                      ) : version.effectiveFrom > new Date() ? (
                        <Badge variant="warning">scheduled</Badge>
                      ) : (
                        <Badge variant="secondary">superseded</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {/* Zone rationale: see AGREEMENT_DISPLAY_TZ above. */}
                      Effective{" "}
                      {formatInstantInAirportTz(
                        version.effectiveFrom,
                        AGREEMENT_DISPLAY_TZ,
                      )}
                      {version.publishedBy ? (
                        <>
                          {" "}
                          · published by{" "}
                          <span className="font-mono text-xs">{version.publishedBy}</span>
                        </>
                      ) : null}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <details className="group">
                      <summary className="w-fit cursor-pointer list-none text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline [&::-webkit-details-marker]:hidden">
                        <span className="group-open:hidden">Read this version ▸</span>
                        <span className="hidden group-open:inline">
                          Read this version ▾
                        </span>
                      </summary>
                      <div className="mt-3 max-h-96 overflow-y-auto rounded-md border border-border p-3">
                        <Markdown>{version.bodyMd}</Markdown>
                      </div>
                    </details>
                  </CardContent>
                </Card>
              ))
            )}
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Publish a new version</CardTitle>
              <CardDescription>
                Every customer with a booking before pickup will be asked to accept again,
                and their agent cannot collect bags until they do. There is no way to
                withdraw a version — publishing another one is the only move.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PublishAgreementForm affectedBookings={affected} />
            </CardContent>
          </Card>
        </div>
      )}
    </ContentColumn>
  );
}

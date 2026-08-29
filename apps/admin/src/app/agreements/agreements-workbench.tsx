"use client";

import * as React from "react";
import { useActionState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DateTimeField,
  FormMessage,
  Input,
  Label,
  RichTextEditor,
} from "@koolee/ui";

import {
  publishAgreement,
  updateScheduledAgreement,
  type AgreementActionState,
} from "./actions";

/**
 * The agreements workbench: one editor on the left, the version history on the
 * right.
 *
 * THE THREE MODES, and why they are three rather than one form with flags:
 *
 *  - **new** — an empty document, published as the next version number;
 *  - **edit** — a version scheduled for the future. Safe because such a
 *    version is not current, so nobody can have accepted it (core and
 *    migration 0024 both enforce that). This is also why the product needs no
 *    separate draft state: scheduling IS drafting;
 *  - **amend** — a version already in effect. Frozen forever, so this does not
 *    edit it. It copies the text into a NEW version, which is the only honest
 *    way to change terms that someone has already agreed to.
 *
 * The mode drives which server action runs and what the confirmation says.
 * Collapsing them into one submit handler would make "am I editing history or
 * writing the future?" a runtime detail, which is precisely the question an
 * operator must never get wrong.
 */

export interface AgreementVersionView {
  id: string;
  version: number;
  title: string;
  bodyMd: string;
  /** ISO. Rendered as UTC — see the note in page.tsx. */
  effectiveFromIso: string;
  /** ISO, when it was published. Drives the month grouping. */
  createdAtIso: string;
  /** `effective_from` is still in the future: editable. */
  scheduled: boolean;
  /** The version in force right now. */
  current: boolean;
}

type Mode =
  | { kind: "new" }
  | { kind: "edit"; version: AgreementVersionView }
  | { kind: "amend"; version: AgreementVersionView };

/* ------------------------------------------------------------------ */
/* Date formatting — UTC, always labelled                              */
/* ------------------------------------------------------------------ */

/**
 * Fixed tables rather than `Intl.DateTimeFormat`: the repo's ESLint rule bans
 * constructing one here (docs/TIME.md), and a fixed table also keeps the label
 * identical for every operator regardless of locale. Same approach as
 * `DateTimeField`.
 *
 * An agreement version belongs to no booking, so "the booking's zone" has
 * nothing to point at. UTC, always with the suffix, matching the UTC input
 * below — an operator reads back exactly what they typed.
 */
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function utcStamp(iso: string): string {
  const d = new Date(iso);
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hours}:${minutes} UTC`;
}

function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()).padStart(2, "0")}`;
}

function monthLabel(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `YYYY-MM-DDTHH:mm` in UTC — the wall-clock string `DateTimeField` posts. */
function toWallClockUtc(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/* ------------------------------------------------------------------ */

export function AgreementsWorkbench({ versions }: { versions: AgreementVersionView[] }) {
  const [mode, setMode] = React.useState<Mode>({ kind: "new" });

  /**
   * Stable, and a genuine no-op when already blank.
   *
   * The editor panel calls this from an effect once a publish succeeds. A
   * fresh arrow per render plus `setMode({ kind: "new" })` — a new object
   * every time — meant React could never bail out of the state update, the
   * effect's dependency changed on every render, and the two fed each other:
   * "Maximum update depth exceeded". Returning the SAME object when the mode
   * is already blank is what actually stops the cycle; `useCallback` alone
   * would not.
   */
  const resetToNew = React.useCallback(() => {
    setMode((current) => (current.kind === "new" ? current : { kind: "new" }));
  }, []);

  return (
    /*
     * 2fr / 1fr, the same split the booking detail uses, so the console has
     * one ratio rather than one per page. History was on `4fr_1fr`, which left
     * it about 300px: every version title wrapped to two lines and the
     * effective-date stamp — the thing you scan this list FOR — wrapped under
     * it. The editor does not need the width it was taking; prose is read at a
     * measure, not at whatever the viewport allows.
     */
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <AgreementEditorPanel
        key={
          // Remount on mode change so the editor, the title and the date all
          // reset together. Without this, switching from "amend v2" to "new"
          // would leave v2's prose in a form that publishes something else.
          mode.kind === "new" ? "new" : `${mode.kind}-${mode.version.id}`
        }
        mode={mode}
        onDone={resetToNew}
      />
      <VersionHistory versions={versions} mode={mode} onSelect={setMode} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Left — the editor                                                   */
/* ------------------------------------------------------------------ */

function AgreementEditorPanel({ mode, onDone }: { mode: Mode; onDone: () => void }) {
  const editing = mode.kind === "edit";
  const source = mode.kind === "new" ? null : mode.version;

  const [state, formAction, pending] = useActionState<AgreementActionState, FormData>(
    editing ? updateScheduledAgreement : publishAgreement,
    {},
  );
  const [body, setBody] = React.useState(source?.bodyMd ?? "");

  // Return to a blank "new" form once a publish or save succeeds, so the next
  // action starts from a known state rather than from stale prose.
  const succeeded = Boolean(state.ok);
  React.useEffect(() => {
    if (succeeded) onDone();
  }, [succeeded, onDone]);

  const heading =
    mode.kind === "new"
      ? "New agreement version"
      : mode.kind === "edit"
        ? `Edit v${source!.version} (scheduled)`
        : `Amend v${source!.version} as a new version`;

  const description =
    mode.kind === "new"
      ? "Published as the next version number. Bookings made from its effective date will accept this text."
      : mode.kind === "edit"
        ? "This version hasn't taken effect yet, so nobody can have accepted it and it's still safe to change. It freezes the moment it goes live."
        : `v${source!.version} is in effect and can never be edited. This publishes a NEW version starting from its text — the only honest way to change terms someone has already agreed to.`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>{heading}</span>
          {mode.kind !== "new" && (
            <Button type="button" variant="ghost" size="sm" onClick={onDone}>
              Start blank instead
            </Button>
          )}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          {editing && <input type="hidden" name="id" value={source!.id} />}
          {/* The editor is client state; this is how it reaches the action. */}
          <input type="hidden" name="bodyMd" value={body} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agreement-title">Title</Label>
            <Input
              id="agreement-title"
              name="title"
              required
              maxLength={200}
              defaultValue={source?.title ?? ""}
              placeholder="Koolee booking agreement"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agreement-body">Agreement text</Label>
            <RichTextEditor
              value={body}
              onChange={setBody}
              aria-label="Agreement text"
              placeholder="Start with a heading — what the customer is booking…"
            />
            <span className="text-xs text-muted-foreground">
              Headings, emphasis, lists, quotes and dividers. Links, images and tables are
              deliberately unavailable: an agreement&apos;s terms have to live in the
              version, not behind one.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agreement-effective">Effective from (UTC)</Label>
            {/* The same control the customer funnel's flight step uses. It
                posts an identical wall-clock string to the native input it
                replaced, so the action's UTC parsing is unchanged. */}
            <DateTimeField
              id="agreement-effective"
              name="effectiveFrom"
              defaultValue={source ? toWallClockUtc(source.effectiveFromIso) : ""}
              hint="Blank means immediately. A past date is refused — it would rewrite which terms a booking made an hour ago was sold under."
            />
          </div>

          {!editing && (
            <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
              This applies to bookings made from its effective date onward. Bookings that
              have already accepted an agreement keep the version they accepted and are
              never asked again — so publishing disturbs nobody who is mid-trip.
            </p>
          )}

          {state.error ? <FormMessage>{state.error}</FormMessage> : null}
          {state.ok ? <FormMessage variant="success">{state.ok}</FormMessage> : null}

          <Button type="submit" loading={pending} className="self-start">
            {editing ? "Save changes" : "Publish version"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Right — the history rail                                            */
/* ------------------------------------------------------------------ */

function VersionHistory({
  versions,
  mode,
  onSelect,
}: {
  versions: AgreementVersionView[];
  mode: Mode;
  onSelect: (mode: Mode) => void;
}) {
  // Grouped by the month they were PUBLISHED in, which is the question the
  // rail answers ("how often have we changed the terms?"). Each row still
  // shows its own effective date, which is a different thing.
  const groups = React.useMemo(() => {
    const byMonth = new Map<string, { label: string; rows: AgreementVersionView[] }>();
    for (const version of versions) {
      const key = monthKey(version.createdAtIso);
      const group = byMonth.get(key) ?? {
        label: monthLabel(version.createdAtIso),
        rows: [],
      };
      group.rows.push(version);
      byMonth.set(key, group);
    }
    return [...byMonth.values()];
  }, [versions]);

  const selectedId = mode.kind === "new" ? null : mode.version.id;

  return (
    /* `top-20`, not `top-6`: the console's top bar is a sticky `h-14`, so a
       24px offset parks this card underneath it. Same offset as the other
       sticky panels in the console. */
    <Card className="lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle className="text-base">History</CardTitle>
        <CardDescription>
          {versions.length} version{versions.length === 1 ? "" : "s"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
        {versions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing published yet. Until there is, every visit is blocked at the identity
            step — the gate fails closed on purpose.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-2">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {group.label}
                <span className="ml-1 normal-case">({group.rows.length})</span>
              </h3>
              {group.rows.map((version) => (
                <div
                  key={version.id}
                  className={
                    "flex flex-col gap-1.5 rounded-lg border p-2 " +
                    (selectedId === version.id ? "border-primary" : "border-border")
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">v{version.version}</span>
                    {version.current ? (
                      <Badge variant="success">current</Badge>
                    ) : version.scheduled ? (
                      <Badge variant="warning">scheduled</Badge>
                    ) : (
                      <Badge variant="secondary">past</Badge>
                    )}
                  </div>
                  <span className="text-xs break-words text-muted-foreground">
                    {version.title}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {utcStamp(version.effectiveFromIso)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 justify-start px-2 text-xs"
                    onClick={() =>
                      onSelect(
                        version.scheduled
                          ? { kind: "edit", version }
                          : { kind: "amend", version },
                      )
                    }
                  >
                    {version.scheduled ? "Edit" : "Amend as new version"}
                  </Button>
                </div>
              ))}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

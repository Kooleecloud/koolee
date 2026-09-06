"use client";

import { History } from "lucide-react";

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
  Markdown,
  RichTextEditor,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
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
 * THE FOUR MODES, and why they are four rather than one form with flags:
 *
 *  - **new** — an empty document, published as the next version number;
 *  - **edit** — a version scheduled for the future. Safe because such a
 *    version is not current, so nobody can have accepted it (core and
 *    migration 0024 both enforce that). This is also why the product needs no
 *    separate draft state: scheduling IS drafting;
 *  - **amend** — a version already in effect. Frozen forever, so this does not
 *    edit it. It copies the text into a NEW version, which is the only honest
 *    way to change terms that someone has already agreed to;
 *  - **view** — a published version, rendered read-only through the SAME
 *    `<Markdown>` the customer's trip page and the printable agreement use.
 *    It runs no action and has no submit button. It exists because reading a
 *    version used to mean opening it in `amend`, one click from publishing a
 *    new one.
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
  | { kind: "amend"; version: AgreementVersionView }
  /**
   * READ A PUBLISHED VERSION, without arming a form that could change it.
   *
   * Until slice F4 the only way to see what v1 actually said was to open it
   * in `amend`, which is a mode whose submit button publishes a NEW version.
   * "Let me just check the wording" and "publish v3" were one click apart,
   * and the console offered no other route. This is that route.
   */
  | { kind: "view"; version: AgreementVersionView };

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

  /*
   * PICKING A VERSION CLOSES THE DRAWER. Without this the history stays open
   * over the editor it just loaded something into, and the operator has to
   * dismiss it to see the result of their own click.
   */
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const selectAndClose = React.useCallback((next: Mode) => {
    setMode(next);
    setHistoryOpen(false);
  }, []);

  return (
    /*
     * THE HISTORY IS A DRAWER, not a rail — TD's call, and it is the right one
     * for what each half is.
     *
     * It was a `2fr / 1fr` split, which is a fine ratio for a master-detail
     * layout and the wrong shape for these two. The editor is a rich-text
     * surface for a legal document: it wants every pixel of width, and prose
     * is read at a measure the viewport should not be arguing with. The
     * history is a list somebody scans occasionally, to view an old version or
     * amend a scheduled one — an act, with a beginning and an end.
     *
     * So the editor gets the page and the history opens over it. Which one is
     * loaded stays visible in the drawer's own list when it is next opened.
     */
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm">
              <History aria-hidden="true" />
              History · {versions.length}
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Version history</SheetTitle>
              <SheetDescription>
                Every version ever published. A version in force can never be edited —
                bookings reference it by id, so editing it would rewrite what past
                acceptors agreed to.
              </SheetDescription>
            </SheetHeader>
            <VersionHistory versions={versions} mode={mode} onSelect={selectAndClose} />
          </SheetContent>
        </Sheet>
      </div>

      {mode.kind === "view" ? (
        <AgreementReaderPanel version={mode.version} onDone={resetToNew} />
      ) : (
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
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Left — the editor                                                   */
/* ------------------------------------------------------------------ */

type EditorMode = Exclude<Mode, { kind: "view" }>;

function AgreementEditorPanel({
  mode,
  onDone,
}: {
  mode: EditorMode;
  onDone: () => void;
}) {
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
              Headings, emphasis, lists, quotes, dividers, links and tables. Images stay
              unavailable: a picture of a clause is a clause nobody can search, quote or
              read aloud. A link may point at a web page or an email address and nothing
              else &mdash; and remember that terms behind a link are not versioned with
              this document, so anything a customer is agreeing TO belongs in the text.
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
/* Left — reading a published version                                  */
/* ------------------------------------------------------------------ */

/**
 * A published version, exactly as a customer sees it.
 *
 * ONE RENDERER, EVERYWHERE AN AGREEMENT BODY APPEARS. `<Markdown>` draws the
 * inline card on the trip page, the printable `/trips/[id]/agreement`, and
 * this. An operator checking a clause is looking at the customer's view of it
 * rather than at a console-specific approximation, which is the only way
 * "does this read right?" is a question worth asking here.
 *
 * NO FORM, NO ACTION, NO SUBMIT. That is the point of the mode: reading and
 * publishing are now different screens rather than the same screen with a
 * different button label.
 */
function AgreementReaderPanel({
  version,
  onDone,
}: {
  version: AgreementVersionView;
  onDone: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            v{version.version} &mdash; {version.title}
            {version.current ? (
              <Badge variant="success">current</Badge>
            ) : version.scheduled ? (
              <Badge variant="warning">scheduled</Badge>
            ) : (
              <Badge variant="secondary">past</Badge>
            )}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Close
          </Button>
        </CardTitle>
        <CardDescription>
          In effect from {utcStamp(version.effectiveFromIso)}. This is the customer&apos;s
          view, drawn by the same renderer their trip page uses. Nothing here can change
          it &mdash; use Amend on the right to publish a new version from this text.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <article className="rounded-md border border-border px-4 py-3">
          <Markdown>{version.bodyMd}</Markdown>
        </article>
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
    <Card className="border-0 shadow-none">
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
                  <div className="flex flex-wrap gap-1">
                    {/* Read comes FIRST, and is the quieter of the two. The
                        common reason to open a version is to check what it
                        says; publishing from it is the rarer, louder act. */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 justify-start px-2 text-xs"
                      onClick={() => onSelect({ kind: "view", version })}
                    >
                      Read
                    </Button>
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
                </div>
              ))}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

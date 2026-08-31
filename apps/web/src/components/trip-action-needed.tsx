"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Check, Download, FileText } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  FormMessage,
  ImageLightbox,
  Markdown,
} from "@koolee/ui";
import { downscalePhoto } from "@koolee/ui/lib/photo";

import {
  acceptAgreementAction,
  type AcceptAgreementState,
} from "@/app/trips/[bookingId]/actions";

/**
 * The two things a customer does between paying and their pickup: accept the
 * booking agreement (required — the visit cannot proceed without it) and,
 * optionally, pre-upload a photo of their passport page.
 *
 * IT IS A SEQUENCE NOW, NOT TWO CARDS SIDE BY SIDE.
 *
 * They used to render as a pair of equal cards in a two-column grid, each
 * carrying its own badge, its own description and its own control, both fully
 * expanded, forever. Three things were wrong with that:
 *
 *  1. Both cards competed for attention when only one of them is a gate. A
 *     customer scanning the page could not tell in what order to do anything,
 *     and the optional one looked exactly as demanding as the required one.
 *  2. They never collapsed. An agreement accepted three weeks ago still owned
 *     half the screen with a "Read the agreement" toggle and two paragraphs
 *     about acceptance, above the timeline the customer actually came for.
 *  3. There was nothing to come back to. Somebody who accepted terms and later
 *     wanted to re-read or keep them had no link and no file.
 *
 * So: a numbered two-step list. The current step is open with its control; a
 * finished step collapses to ONE LINE with a green check and the two things
 * that make it worth keeping — read the agreement again, save it as a PDF, or
 * view the passport photo you sent. Once both are done and the visit has
 * happened, the whole section disappears, as it always did.
 */

export interface TripAgreementView {
  /** Null only when no agreement has ever been published. */
  version: number | null;
  title: string;
  bodyMd: string;
  /** Preformatted in the booking's zone (docs/TIME.md). */
  effectiveLabel: string | null;
  accepted: boolean;
  /** Preformatted acceptance instant, booking's zone. */
  acceptedAtLabel: string | null;
}

export interface TripPassportView {
  status: "pending" | "customer_uploaded" | "agent_confirmed" | "failed";
  /** Short-TTL signed URL, or null when there is nothing to show. */
  photoUrl: string | null;
}

export function TripActionNeeded({
  bookingId,
  agreement,
  passport,
  /** False once the visit has happened — nothing here is actionable then. */
  actionable,
}: {
  bookingId: string;
  agreement: TripAgreementView;
  passport: TripPassportView;
  actionable: boolean;
}) {
  const agreementDone = agreement.accepted || !actionable;
  const passportDone = passport.status !== "pending";

  // Nothing left to do and nothing left to say.
  if (agreementDone && passportDone && !actionable) return null;

  /*
   * WHICH STEP IS OPEN. The agreement is a gate, so it holds the sequence
   * until it is accepted — the passport step stays collapsed and unnumbered
   * behind it rather than offering a second thing to do first. Once the
   * agreement is in, the passport opens.
   */
  const openStep = agreement.accepted ? ("passport" as const) : ("agreement" as const);
  const remaining = (agreement.accepted ? 0 : 1) + (passportDone ? 0 : 1);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-lg">
          {agreement.accepted ? "Before your pickup" : "Action needed"}
        </h2>
        {!agreement.accepted && actionable && (
          <Badge variant="warning">1 thing to do</Badge>
        )}
        {agreement.accepted && remaining > 0 && actionable && (
          <Badge variant="secondary">1 optional step left</Badge>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-col gap-0 divide-y divide-border p-0">
          <AgreementStep
            bookingId={bookingId}
            agreement={agreement}
            actionable={actionable}
            open={openStep === "agreement"}
          />
          <PassportStep
            bookingId={bookingId}
            passport={passport}
            actionable={actionable}
            open={openStep === "passport"}
          />
        </CardContent>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The shared step chrome                                              */
/* ------------------------------------------------------------------ */

/**
 * One row of the sequence: a numbered marker (or a green check once done), a
 * title, and whatever the step needs beneath it.
 *
 * The marker is what makes this read as a sequence rather than a list. A done
 * step keeps its row and its check — removing it would make the page shorter
 * and the progress invisible.
 */
function Step({
  index,
  done,
  title,
  meta,
  children,
}: {
  index: number;
  done: boolean;
  title: React.ReactNode;
  /** The right-hand side of the title row — a badge, usually. */
  meta?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 p-4 sm:gap-4 sm:p-5">
      <span
        aria-hidden
        className={
          done
            ? "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"
            : "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold text-sky-800"
        }
      >
        {done ? <Check className="size-3.5" /> : index}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-base font-medium text-navy-800">{title}</h3>
          {meta}
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1. The agreement                                                     */
/* ------------------------------------------------------------------ */

function AgreementStep({
  bookingId,
  agreement,
  actionable,
  open,
}: {
  bookingId: string;
  agreement: TripAgreementView;
  actionable: boolean;
  open: boolean;
}) {
  const [state, formAction, pending] = useActionState<AcceptAgreementState, FormData>(
    acceptAgreementAction,
    {},
  );
  const [reading, setReading] = React.useState(false);

  if (agreement.version === null) {
    // Nothing published. Say nothing about acceptance rather than showing a
    // button that cannot work — the gate fails closed in core and ops will
    // see the visit blocked, which is the right place for that alarm.
    return null;
  }

  /* --- done: one line, plus the two things worth keeping ------------- */
  if (agreement.accepted) {
    return (
      <Step
        index={1}
        done
        title={agreement.title}
        meta={<Badge variant="success">accepted</Badge>}
      >
        <p className="text-sm text-muted-foreground">
          {/* Version pinning: this is the document the booking is bound by,
              and it stays this one however many versions publish later. */}
          You accepted version {agreement.version}
          {agreement.acceptedAtLabel ? ` on ${agreement.acceptedAtLabel}` : ""}. These are
          the terms for this trip — a later update won&apos;t change them or ask you
          again.
        </p>
        <AgreementLinks
          bookingId={bookingId}
          reading={reading}
          onToggleReading={() => setReading((v) => !v)}
          bodyMd={agreement.bodyMd}
        />
      </Step>
    );
  }

  /* --- not accepted, and cannot be (post-visit, or past the gate) ---- */
  if (!actionable) {
    return (
      <Step index={1} done={false} title={agreement.title}>
        <p className="text-sm text-muted-foreground">
          This trip has moved past the point where the agreement is accepted online.
        </p>
      </Step>
    );
  }

  /* --- the gate ------------------------------------------------------ */
  return (
    <Step
      index={1}
      done={false}
      title={agreement.title}
      meta={<Badge variant="warning">needs your OK</Badge>}
    >
      <p className="text-sm text-muted-foreground">
        Version {agreement.version}
        {agreement.effectiveLabel ? `, in effect from ${agreement.effectiveLabel}` : ""}.
        Your agent can&apos;t collect your bags until this is accepted.
      </p>

      {open && (
        <>
          <AgreementLinks
            bookingId={bookingId}
            reading={reading}
            onToggleReading={() => setReading((v) => !v)}
            bodyMd={agreement.bodyMd}
          />

          <form action={formAction} className="flex flex-col gap-3">
            <input type="hidden" name="bookingId" value={bookingId} />
            {state.error && <FormMessage>{state.error}</FormMessage>}
            <Button type="submit" loading={pending} className="self-start">
              I accept this agreement
            </Button>
          </form>
        </>
      )}
    </Step>
  );
}

/**
 * Read it here, or keep a copy.
 *
 * THE PDF IS A PRINT VIEW, NOT A GENERATED FILE. `/trips/[id]/agreement` is a
 * server-rendered page of the exact version this booking is bound by, styled
 * for paper, that opens its own print dialog — every browser's "Save as PDF"
 * turns that into a file. A real PDF pipeline would be a dependency, a font
 * bundle and a rendering surface to maintain, for an artefact whose whole job
 * is to be readable and keepable.
 */
function AgreementLinks({
  bookingId,
  reading,
  onToggleReading,
  bodyMd,
}: {
  bookingId: string;
  reading: boolean;
  onToggleReading: () => void;
  bodyMd: string;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={reading}
          onClick={onToggleReading}
        >
          <FileText aria-hidden className="size-4" />
          {reading ? "Hide the agreement" : "Read the agreement"}
        </Button>
        <Button asChild variant="ghost" size="sm">
          <a href={`/trips/${bookingId}/agreement`} target="_blank" rel="noopener">
            <Download aria-hidden className="size-4" />
            Download as PDF
          </a>
        </Button>
      </div>

      {reading && (
        <div className="max-h-96 overflow-y-auto rounded-lg border border-border p-4">
          <Markdown>{bodyMd}</Markdown>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 2. The passport                                                      */
/* ------------------------------------------------------------------ */

const PASSPORT_COPY: Record<TripPassportView["status"], string> = {
  pending:
    "Your agent checks your passport at the door. Adding a photo now just makes that quicker — it's optional.",
  customer_uploaded:
    "Thanks — we have your photo. Your agent will still check your passport against it at the door.",
  agent_confirmed: "Your agent confirmed your passport at pickup.",
  failed: "We're sorting this out with you — nothing for you to do here.",
};

function PassportStep({
  bookingId,
  passport,
  actionable,
  open,
}: {
  bookingId: string;
  passport: TripPassportView;
  actionable: boolean;
  open: boolean;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [viewing, setViewing] = React.useState(false);

  const done = passport.status !== "pending";
  const canUpload =
    actionable &&
    (passport.status === "pending" || passport.status === "customer_uploaded");

  async function onFileChosen() {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("bookingId", bookingId);
      // Shrink before it leaves the phone: an untouched camera capture is
      // 3–8 MB, and the customer is often on mobile data at this point.
      body.append("passport", await downscalePhoto(file));

      const response = await fetch("/api/passport-photos", { method: "POST", body });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (payload.ok) {
        router.refresh();
        return;
      }
      setError(payload.error ?? "Upload failed. Please try again.");
    } catch {
      setError("Upload failed — check your connection and try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  /* --- done: one line, and the photo one click away ------------------ */
  if (done) {
    return (
      <Step
        index={2}
        done
        title="Passport"
        meta={
          passport.status === "agent_confirmed" ? (
            <Badge variant="success">confirmed</Badge>
          ) : passport.status === "failed" ? (
            <Badge variant="secondary">with our team</Badge>
          ) : (
            <Badge variant="secondary">uploaded</Badge>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {PASSPORT_COPY[passport.status]}
          </p>
        </div>

        {passport.photoUrl && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={viewing}
              onClick={() => setViewing((v) => !v)}
            >
              {viewing ? "Hide" : "View"}
            </Button>
            {viewing && (
              <ImageLightbox
                src={passport.photoUrl}
                alt="The passport page you uploaded"
                title="Your passport photo"
                description="Only you and your assigned agent can see this."
                className="h-24 w-24"
              />
            )}
          </div>
        )}

        {canUpload && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="sr-only"
              aria-label="Passport photo"
              onChange={onFileChosen}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={busy}
              className="self-start"
              onClick={() => inputRef.current?.click()}
            >
              Replace the photo
            </Button>
          </>
        )}

        {error && <FormMessage variant="error">{error}</FormMessage>}
      </Step>
    );
  }

  /* --- still to do --------------------------------------------------- */
  return (
    <Step
      index={2}
      done={false}
      title="Passport"
      // "optional", not "needs your OK" — this step must never read as a
      // second requirement.
      meta={<Badge variant="secondary">optional</Badge>}
    >
      <p className="text-sm text-muted-foreground">{PASSPORT_COPY[passport.status]}</p>

      {open && canUpload && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="sr-only"
            aria-label="Passport photo"
            onChange={onFileChosen}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={busy}
            className="self-start"
            onClick={() => inputRef.current?.click()}
          >
            Add a passport photo
          </Button>
          <p className="text-xs text-muted-foreground">
            Stored privately and only ever shown to you and your assigned agent. We keep
            the photo and nothing else — we never record your passport number, name, or
            date of birth.
          </p>
        </>
      )}

      {/* Not open yet: the agreement is the gate and holds the sequence. */}
      {!open && actionable && (
        <p className="text-xs text-muted-foreground">
          Available once you&apos;ve accepted the agreement above.
        </p>
      )}

      {error && <FormMessage variant="error">{error}</FormMessage>}
    </Step>
  );
}

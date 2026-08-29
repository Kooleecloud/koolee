"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
 * The two things a customer can do between paying and their pickup: accept the
 * booking agreement (required — the visit cannot proceed without it) and,
 * optionally, pre-upload a photo of their passport page.
 *
 * The asymmetry is the design. The agreement is a gate, so it leads and says
 * so. The passport is a convenience — the agent verifies at the door either
 * way — so it must never read as a second required step, or people who cannot
 * photograph a passport on a phone will think they cannot travel with us.
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
  /** Accepted an EARLIER version, and the terms have since changed. */
  superseded: boolean;
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

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-lg">
          {agreement.accepted ? "Before your pickup" : "Action needed"}
        </h2>
        {!agreement.accepted && actionable && (
          <Badge variant="warning">1 thing to do</Badge>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <AgreementCard
          bookingId={bookingId}
          agreement={agreement}
          actionable={actionable}
        />
        <PassportCard bookingId={bookingId} passport={passport} actionable={actionable} />
      </div>
    </section>
  );
}

function AgreementCard({
  bookingId,
  agreement,
  actionable,
}: {
  bookingId: string;
  agreement: TripAgreementView;
  actionable: boolean;
}) {
  const [state, formAction, pending] = useActionState<AcceptAgreementState, FormData>(
    acceptAgreementAction,
    {},
  );
  const [open, setOpen] = React.useState(false);

  if (agreement.version === null) {
    // Nothing published. Say nothing about acceptance rather than showing a
    // button that cannot work — the gate fails closed in core and ops will
    // see the visit blocked, which is the right place for that alarm.
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 font-display text-base">
          <span>{agreement.title}</span>
          {agreement.accepted ? (
            <Badge variant="success">accepted</Badge>
          ) : (
            <Badge variant="warning">needs your OK</Badge>
          )}
        </CardTitle>
        <CardDescription>
          {agreement.accepted ? (
            <>
              You accepted version {agreement.version}
              {agreement.acceptedAtLabel ? ` on ${agreement.acceptedAtLabel}` : ""}.
            </>
          ) : agreement.superseded ? (
            // Materially different from "you have not accepted", which would
            // be false to someone who remembers accepting.
            <>
              Our agreement was updated — please review version {agreement.version} and
              accept again.
            </>
          ) : (
            <>
              Version {agreement.version}
              {agreement.effectiveLabel
                ? `, in effect from ${agreement.effectiveLabel}`
                : ""}
              . Your agent can&apos;t collect your bags until this is accepted.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide the agreement" : "Read the agreement"}
        </Button>
        {open && (
          <div className="max-h-96 overflow-y-auto rounded-lg border border-border p-4">
            <Markdown>{agreement.bodyMd}</Markdown>
          </div>
        )}

        {!agreement.accepted && actionable && (
          <form action={formAction} className="flex flex-col gap-3">
            <input type="hidden" name="bookingId" value={bookingId} />
            {state.error && <FormMessage>{state.error}</FormMessage>}
            <Button type="submit" loading={pending} className="self-start">
              I accept this agreement
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

const PASSPORT_COPY: Record<TripPassportView["status"], string> = {
  pending:
    "Your agent checks your passport at the door. Adding a photo now just makes that quicker — it's optional.",
  customer_uploaded:
    "Thanks — we have your photo. Your agent will still check your passport against it at the door.",
  agent_confirmed: "Your agent confirmed your passport at pickup.",
  failed: "We're sorting this out with you — nothing for you to do here.",
};

function PassportCard({
  bookingId,
  passport,
  actionable,
}: {
  bookingId: string;
  passport: TripPassportView;
  actionable: boolean;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 font-display text-base">
          <span>Passport</span>
          {passport.status === "agent_confirmed" ? (
            <Badge variant="success">confirmed</Badge>
          ) : passport.status === "customer_uploaded" ? (
            <Badge variant="secondary">uploaded</Badge>
          ) : (
            // "optional", not "needs your OK" — this card must never read as a
            // second requirement.
            <Badge variant="secondary">optional</Badge>
          )}
        </CardTitle>
        <CardDescription>{PASSPORT_COPY[passport.status]}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {passport.photoUrl && (
          <ImageLightbox
            src={passport.photoUrl}
            alt="The passport page you uploaded"
            title="Your passport photo"
            description="Only you and your assigned agent can see this."
            className="h-24 w-24"
          />
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
              variant="outline"
              size="sm"
              loading={busy}
              className="self-start"
              onClick={() => inputRef.current?.click()}
            >
              {passport.status === "customer_uploaded"
                ? "Replace the photo"
                : "Add a passport photo"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Stored privately and only ever shown to you and your assigned agent. We keep
              the photo and nothing else — we never record your passport number, name, or
              date of birth.
            </p>
          </>
        )}

        {error && <FormMessage variant="error">{error}</FormMessage>}
      </CardContent>
    </Card>
  );
}

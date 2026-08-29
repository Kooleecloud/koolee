"use client";

import * as React from "react";
import { useActionState } from "react";
import {
  Button,
  CheckboxField,
  FormMessage,
  Input,
  Label,
  Markdown,
  Spinner,
  usePreservedFormValues,
} from "@koolee/ui";

import { publishAgreement, type PublishAgreementState } from "./actions";

/**
 * Publishing a new version.
 *
 * The confirmation is a checkbox naming a NUMBER, not a generic "are you
 * sure". Publishing un-gates every in-flight booking the moment the version
 * takes effect, and each of those customers is asked to accept again — that
 * cost is invisible unless it is spelled out, so the operator has to look at
 * it and tick it. The count is recomputed server-side; this is the
 * acknowledgement, not the check.
 */
export function PublishAgreementForm({ affectedBookings }: { affectedBookings: number }) {
  const [state, formAction, pending] = useActionState<PublishAgreementState, FormData>(
    publishAgreement,
    {},
  );
  const { formRef, captureValues } = usePreservedFormValues(state);
  const [body, setBody] = React.useState("");
  const [preview, setPreview] = React.useState(false);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={captureValues}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agreement-title">Title</Label>
        <Input
          id="agreement-title"
          name="title"
          required
          maxLength={200}
          placeholder="Koolee booking agreement"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="agreement-body">Body (Markdown)</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPreview((v) => !v)}
          >
            {preview ? "Edit" : "Preview"}
          </Button>
        </div>
        {preview ? (
          <div className="min-h-48 rounded-md border border-border p-4">
            {body.trim() ? (
              <Markdown>{body}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
            )}
          </div>
        ) : (
          <textarea
            id="agreement-body"
            name="bodyMd"
            required
            rows={16}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
            placeholder={"## What you are booking\n\nWe collect your bags…"}
          />
        )}
        {/* The textarea is unmounted while previewing, so its value would not
            post. Carry it in a hidden field instead of blocking submit. */}
        {preview && <input type="hidden" name="bodyMd" value={body} />}
        <span className="text-xs text-muted-foreground">
          Headings, lists, bold and italic. Links are not rendered — an agreement&apos;s
          terms have to live in the version, not behind one.
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agreement-effective">Effective from (UTC)</Label>
        <Input id="agreement-effective" name="effectiveFrom" type="datetime-local" />
        <span className="text-xs text-muted-foreground">
          Blank means immediately. A past date is refused: it would retroactively
          un-accept bookings that are already in flight, possibly mid-visit.
        </span>
      </div>

      <div className="rounded-lg border border-destructive/40 p-3">
        <CheckboxField
          name="acknowledged"
          required
          label={
            <>
              I understand that <strong>{affectedBookings}</strong> in-flight booking
              {affectedBookings === 1 ? "" : "s"} will be asked to accept this version
              again, and that an agent cannot collect bags until each customer has.
            </>
          }
          labelClassName="text-sm font-normal"
        />
      </div>

      {state.error ? <FormMessage>{state.error}</FormMessage> : null}
      {state.ok ? <FormMessage variant="success">{state.ok}</FormMessage> : null}

      <Button type="submit" className="self-start">
        {pending ? <Spinner /> : "Publish version"}
      </Button>
    </form>
  );
}

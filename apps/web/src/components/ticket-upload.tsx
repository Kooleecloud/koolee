"use client";

import * as React from "react";
import { useActionState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormMessage,
} from "@koolee/ui";

import { extractTicket, type ActionState } from "@/app/book/actions";

/**
 * Ticket PDF upload. What we read off the e-ticket only PREFILLS the flight
 * form below — the customer always reviews and confirms it there.
 */
export function TicketUpload() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    extractTicket,
    {},
  );
  const inputRef = React.useRef<HTMLInputElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Upload your ticket instead</CardTitle>
        <CardDescription>
          We&apos;ll read the flight details off your e-ticket PDF and fill in the form
          for you to review.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form ref={formRef} action={formAction}>
          <input
            ref={inputRef}
            type="file"
            name="ticket"
            accept="application/pdf,.pdf"
            className="sr-only"
            aria-label="Ticket PDF"
            onChange={() => {
              if (inputRef.current?.files?.length) formRef.current?.requestSubmit();
            }}
          />
          <Button
            type="button"
            variant="outline"
            loading={pending}
            onClick={() => inputRef.current?.click()}
          >
            {pending ? "Reading your ticket…" : "Upload ticket PDF"}
          </Button>
        </form>

        {state.error && <FormMessage variant="error">{state.error}</FormMessage>}
      </CardContent>
    </Card>
  );
}

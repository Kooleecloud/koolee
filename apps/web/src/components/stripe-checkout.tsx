"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CTAButton,
  Input,
  Label,
} from "@koolee/ui";

import {
  preparePayment,
  saveCheckoutContactPhone,
} from "@/app/book/pay/actions";

/**
 * The Stripe Payment Element checkout card.
 *
 * On mount it asks the server (`preparePayment`) to create-or-reuse the
 * draft's PaymentIntent — one intent per funnel draft — and mounts the
 * Payment Element against the returned client secret. Confirmation always
 * redirects to /book/return, where a SERVER-side status re-check decides the
 * outcome; nothing here treats a client-side signal as success.
 *
 * `loadStripe` stays lazy inside a memo: at module scope it would fire on
 * every page that imports this file, including ones with no payment on them.
 */

type CheckoutState =
  | { status: "preparing" }
  | { status: "error"; message: string }
  | { status: "ready"; bookingId: string; clientSecret: string; amountCents: number };

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function StripeCheckout({ needsContactPhone }: { needsContactPhone: boolean }) {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  const stripePromise = useMemo<Promise<Stripe | null> | null>(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );

  const router = useRouter();
  const [state, setState] = useState<CheckoutState>({ status: "preparing" });
  // Strict-mode double-invoke guard: one prepare call per mount, so dev can
  // never race two intent creations from the same page.
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;

    void (async () => {
      try {
        const result = await preparePayment();
        if (!result.ok) {
          if (result.redirectTo) {
            router.replace(result.redirectTo);
            return;
          }
          setState({ status: "error", message: result.error });
          return;
        }
        if (result.kind === "redirect") {
          router.replace(result.redirectTo);
          return;
        }
        setState({
          status: "ready",
          bookingId: result.bookingId,
          clientSecret: result.clientSecret,
          amountCents: result.amountCents,
        });
      } catch (error) {
        console.error("[stripe-checkout] preparePayment failed", error);
        setState({
          status: "error",
          message:
            "We couldn't set up the payment. You have not been charged — please try again.",
        });
      }
    })();
  }, [router]);

  if (!stripePromise) return null;

  if (state.status === "preparing") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Card details</CardTitle>
          <CardDescription>Setting up secure payment…</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="h-24 animate-pulse rounded-md border border-dashed bg-muted/40"
            aria-hidden
          />
        </CardContent>
      </Card>
    );
  }

  if (state.status === "error") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment unavailable</CardTitle>
          <CardDescription>{state.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret: state.clientSecret }}>
      <CheckoutForm
        bookingId={state.bookingId}
        amountCents={state.amountCents}
        needsContactPhone={needsContactPhone}
      />
    </Elements>
  );
}

function CheckoutForm({
  bookingId,
  amountCents,
  needsContactPhone,
}: {
  bookingId: string;
  amountCents: number;
  needsContactPhone: boolean;
}) {
  const stripe = useStripe();
  const elements = useElements();

  // Controlled inputs: values survive a failed attempt by construction — the
  // same guarantee usePreservedFormValues gives the uncontrolled action forms.
  const [contactPhone, setContactPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements || submitting) return;

    setSubmitting(true);
    setMessage(null);

    // Every exit path below must either re-enable the button or be a redirect.
    // Note there is deliberately NO `finally { setSubmitting(false) }`: the
    // success path leaves this component mounted while the browser navigates to
    // /book/return, and re-enabling the button there would reopen a
    // double-submit window on a payment that already went through.
    try {
      if (needsContactPhone) {
        const saved = await saveCheckoutContactPhone(bookingId, contactPhone);
        if (!saved.ok) {
          setMessage(saved.error);
          setSubmitting(false);
          return;
        }
      }

      // Always redirects to /book/return on success (3DS challenges included);
      // the server-side re-check there is what advances the booking.
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/book/return?booking=${bookingId}`,
        },
      });

      // Only reached when confirmation failed before any redirect. Copy never
      // overclaims: a declined/incomplete attempt has taken no money.
      if (error) {
        setMessage(
          (error.type === "card_error" || error.type === "validation_error") &&
            error.message
            ? error.message
            : "We couldn't process that card. You have not been charged — try again or use a different card.",
        );
        setSubmitting(false);
      }
    } catch (error) {
      // A THROW, not a returned `error`: a dropped connection, a Stripe.js
      // failure, or the server action rejecting. Without this the button stayed
      // disabled forever with no message — the customer's only way out of the
      // payment step was to reload and hope.
      //
      // Logged as well as shown: the customer-facing copy is deliberately vague
      // about what happened, so swallowing the cause entirely would leave a
      // failed payment with no diagnostic trail at all.
      console.error("[checkout] payment confirmation threw", error);

      // Copy stays honest about the one thing we genuinely do not know here:
      // whether the confirmation reached Stripe. It does not claim "you have
      // not been charged" (we cannot tell), and it does not promise automatic
      // recovery — reconciliation runs on /book/return, which this attempt
      // never reached. What IS safe to say is that a retry cannot double-charge:
      // `ensureBookingPaymentIntent` keeps exactly one intent per draft.
      setMessage(
        "We couldn't complete that payment — the connection may have dropped. " +
          "Try again; this booking has a single payment attached, so retrying " +
          "cannot charge you twice.",
      );
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Card details</CardTitle>
          <CardDescription>
            {dollars(amountCents)} is authorized now and only charged when an agent has
            collected and sealed your bags.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {needsContactPhone && (
            <div className="grid gap-2">
              <Label htmlFor="contactPhone">
                Contact number for the driver on pickup day
              </Label>
              <Input
                id="contactPhone"
                name="contactPhone"
                type="tel"
                inputMode="tel"
                placeholder="+1 (212) 555-0100"
                autoComplete="tel"
                required
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Any number the driver can call at the door — no verification needed.
              </p>
            </div>
          )}

          <PaymentElement />

          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
        </CardContent>
      </Card>

      <CTAButton
        type="submit"
        size="lg"
        className="w-full"
        disabled={!stripe || submitting}
        loading={submitting}
      >
        {submitting ? "Authorizing…" : `Authorize ${dollars(amountCents)} and book`}
      </CTAButton>

      <p className="text-xs text-muted-foreground">
        By booking you agree that Koolee collects your bags and delivers them to your
        airline&apos;s bag drop. You check in with your airline as usual.
      </p>
    </form>
  );
}

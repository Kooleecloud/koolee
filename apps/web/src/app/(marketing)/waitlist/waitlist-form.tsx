"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CTAButton, FormMessage, Input, Label, usePreservedFormValues } from "@koolee/ui";
import { CircleCheck } from "lucide-react";

import { joinWaitlist, type WaitlistState } from "./actions";

const INITIAL: WaitlistState = { status: "idle" };

export function WaitlistForm() {
  const [state, formAction, pending] = React.useActionState(joinWaitlist, INITIAL);
  const { formRef, captureValues } = usePreservedFormValues(state, state.status === "error");
  const reduceMotion = useReducedMotion();

  const fade = {
    initial: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 },
    animate: reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 },
    exit: { opacity: 0 },
  };

  return (
    <div className="rounded-2xl border border-border bg-white p-6 shadow-lift sm:p-8">
      <AnimatePresence mode="wait" initial={false}>
        {state.status === "success" ? (
          <motion.div
            key="done"
            {...fade}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-start gap-3"
            role="status"
          >
            <CircleCheck aria-hidden="true" className="size-8 text-success" />
            <h2 className="font-display text-lg font-semibold text-navy-800">
              You&apos;re on the list.
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We&apos;ll email you the day your neighborhood opens — and nothing else.
            </p>
          </motion.div>
        ) : state.status === "in-coverage" ? (
          <motion.div
            key="covered"
            {...fade}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-start gap-3"
            role="status"
          >
            <CircleCheck aria-hidden="true" className="size-8 text-success" />
            <h2 className="font-display text-lg font-semibold text-navy-800">
              Good news — we already cover you.
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              That ZIP is inside our pickup area. No waitlist needed; you can book a
              pickup right now.
            </p>
            <CTAButton asChild className="mt-2">
              <Link href="/book">Book a pickup</Link>
            </CTAButton>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            ref={formRef}
            onSubmit={captureValues}
            {...fade}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            action={formAction}
            className="flex flex-col gap-5"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="waitlist-email">Email</Label>
              <Input
                id="waitlist-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                disabled={pending}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="waitlist-zip">ZIP code</Label>
              <Input
                id="waitlist-zip"
                name="zip"
                inputMode="numeric"
                maxLength={5}
                required
                placeholder="11201"
                disabled={pending}
              />
            </div>

            {state.status === "error" && state.message ? (
              <FormMessage variant="error">{state.message}</FormMessage>
            ) : null}

            <CTAButton type="submit" size="lg" className="w-full" loading={pending}>
              {pending ? "Adding you…" : "Join the waitlist"}
            </CTAButton>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

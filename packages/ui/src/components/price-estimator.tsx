"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { Minus, Plus } from "lucide-react";

import { cn } from "../lib/utils";

/**
 * Interactive price estimate widget. The maths lives server-side — the app
 * passes a server action wrapping the core pricing engine, so the number a
 * visitor sees is computed by the same code that prices a real booking.
 */

export interface PriceEstimateLine {
  label: string;
  amountCents: number;
}

export interface PriceEstimateResult {
  totalCents: number;
  currency: string;
  lines: PriceEstimateLine[];
}

export interface PriceEstimatorTier {
  id: string;
  label: string;
  description?: string;
}

export interface PriceEstimatorAirport {
  code: string;
  label: string;
}

export interface PriceEstimatorInput {
  bagCount: number;
  tierId: string;
  airportCode: string;
}

export interface PriceEstimatorProps {
  estimate: (input: PriceEstimatorInput) => Promise<PriceEstimateResult>;
  tiers: PriceEstimatorTier[];
  airports: PriceEstimatorAirport[];
  initialBagCount?: number;
  maxBags?: number;
  disclaimer?: React.ReactNode;
  className?: string;
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function PriceEstimator({
  estimate,
  tiers,
  airports,
  initialBagCount = 2,
  maxBags = 6,
  disclaimer,
  className,
}: PriceEstimatorProps) {
  const firstTier = tiers[0];
  const firstAirport = airports[0];
  const [bagCount, setBagCount] = React.useState(initialBagCount);
  const [tierId, setTierId] = React.useState(firstTier?.id ?? "");
  const [airportCode, setAirportCode] = React.useState(firstAirport?.code ?? "");
  const [result, setResult] = React.useState<PriceEstimateResult | null>(null);
  const [isPending, startTransition] = React.useTransition();
  const requestSeq = React.useRef(0);
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    if (!tierId || !airportCode) return;
    const seq = ++requestSeq.current;
    startTransition(async () => {
      try {
        const next = await estimate({ bagCount, tierId, airportCode });
        if (requestSeq.current === seq) setResult(next);
      } catch {
        if (requestSeq.current === seq) setResult(null);
      }
    });
  }, [bagCount, tierId, airportCode, estimate]);

  return (
    <div
      className={cn(
        "grid gap-8 rounded-2xl border border-border bg-white p-6 shadow-lift sm:p-8",
        "lg:grid-cols-[1.2fr_1fr]",
        className,
      )}
    >
      <div className="flex flex-col gap-7">
        {/* Airport */}
        <fieldset>
          <legend className="mb-2.5 text-sm font-semibold text-navy-800">Airport</legend>
          <div className="inline-flex rounded-lg border border-input bg-muted p-1">
            {airports.map((airport) => (
              <label key={airport.code} className="cursor-pointer">
                <input
                  type="radio"
                  name="estimator-airport"
                  value={airport.code}
                  checked={airportCode === airport.code}
                  onChange={() => setAirportCode(airport.code)}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    "inline-flex rounded-md px-4 py-1.5 text-sm font-medium text-navy-600",
                    "transition-colors peer-checked:bg-navy-800 peer-checked:text-white",
                    "peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                  )}
                >
                  {airport.code}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Bags */}
        <div>
          <p id="estimator-bags-label" className="mb-2.5 text-sm font-semibold text-navy-800">
            Bags
          </p>
          <div className="inline-flex items-center gap-4">
            <button
              type="button"
              onClick={() => setBagCount((n) => Math.max(1, n - 1))}
              disabled={bagCount <= 1}
              aria-label="Remove a bag"
              className={cn(
                "inline-flex size-10 items-center justify-center rounded-full border",
                "border-input bg-white text-navy-800 transition-colors hover:bg-navy-50",
                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:pointer-events-none disabled:opacity-40",
              )}
            >
              <Minus className="size-4" />
            </button>
            <span
              aria-labelledby="estimator-bags-label"
              aria-live="polite"
              className="min-w-8 text-center font-display text-2xl font-semibold text-navy-900"
            >
              {bagCount}
            </span>
            <button
              type="button"
              onClick={() => setBagCount((n) => Math.min(maxBags, n + 1))}
              disabled={bagCount >= maxBags}
              aria-label="Add a bag"
              className={cn(
                "inline-flex size-10 items-center justify-center rounded-full border",
                "border-input bg-white text-navy-800 transition-colors hover:bg-navy-50",
                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:pointer-events-none disabled:opacity-40",
              )}
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>

        {/* Pickup window tier */}
        <fieldset>
          <legend className="mb-2.5 text-sm font-semibold text-navy-800">
            Pickup window
          </legend>
          <div className="flex flex-col gap-2">
            {tiers.map((tier) => (
              <label key={tier.id} className="cursor-pointer">
                <input
                  type="radio"
                  name="estimator-tier"
                  value={tier.id}
                  checked={tierId === tier.id}
                  onChange={() => setTierId(tier.id)}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    "flex items-baseline justify-between gap-3 rounded-lg border px-4 py-3",
                    "transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                    tierId === tier.id
                      ? "border-sky-500 bg-sky-50"
                      : "border-input bg-white hover:border-navy-200",
                  )}
                >
                  <span className="text-sm font-medium text-navy-900">{tier.label}</span>
                  {tier.description ? (
                    <span className="text-xs text-muted-foreground">{tier.description}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {/* Result */}
      <div className="flex flex-col justify-between gap-6 rounded-xl bg-navy-800 p-6 text-white">
        <div>
          <p className="text-sm font-medium text-navy-200">Your estimate</p>
          <motion.p
            key={result?.totalCents ?? "pending"}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            aria-live="polite"
            className={cn(
              "mt-1 font-display text-5xl font-semibold tracking-tight",
              isPending && "opacity-60",
            )}
          >
            {result ? formatMoney(result.totalCents, result.currency) : "—"}
          </motion.p>
        </div>

        {result && result.lines.length > 0 ? (
          <dl className="flex flex-col gap-2 border-t border-white/15 pt-4 text-sm">
            {result.lines.map((line) => (
              <div key={line.label} className="flex items-baseline justify-between gap-4">
                <dt className="text-navy-200">{line.label}</dt>
                <dd className="font-medium tabular-nums">
                  {formatMoney(line.amountCents, result.currency)}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {disclaimer ? <p className="text-xs leading-relaxed text-navy-300">{disclaimer}</p> : null}
      </div>
    </div>
  );
}

export { PriceEstimator };

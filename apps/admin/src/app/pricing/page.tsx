import { redirect } from "next/navigation";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DatabaseNotConfigured,
  EmptyState,
  PageHeader,
} from "@koolee/ui";
import { listPricingRules, type PricingRule } from "@koolee/core";

import { ConsoleMain } from "@/components/console";
import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

import { PublishPricingRuleForm, ReactivateRuleForm } from "./pricing-forms";

export const metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

/**
 * What a booking costs.
 *
 * Before Tier 5 this page did not exist and there were exactly two ways to
 * change a price: edit `seed.ts` and re-run the seed — which does not merge,
 * it CONVERGES, overwriting the active rule field by field — or write SQL
 * against production. Both are now closed: the seed refuses a hosted database
 * and this is the path.
 *
 * A change PUBLISHES a new rule rather than editing the live one, so the
 * history below is the record of what Koolee has charged and when.
 */

const dollars = (cents: number) => (cents / 100).toFixed(2);

/** `[{maxLeadMinutes: 600, multiplier: 1.4}]` → `"10 1.4"`, one per line. */
function curveToText(rule: PricingRule): string {
  return rule.leadTimeMultipliers
    .map((step) => `${step.maxLeadMinutes / 60} ${step.multiplier}`)
    .join("\n");
}

/** A human summary of the curve, for the history rows. */
function curveSummary(rule: PricingRule): string {
  if (rule.leadTimeMultipliers.length === 0) return "flat";
  return rule.leadTimeMultipliers
    .map((step) => `≤${step.maxLeadMinutes / 60}h ×${step.multiplier}`)
    .join(" · ");
}

export default async function PricingPage() {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const core = tryGetCore();
  let rules: PricingRule[] = [];
  let unavailable = core === null;

  if (core) {
    try {
      rules = await listPricingRules(core.db);
    } catch {
      unavailable = true;
    }
  }

  const active = rules.find((rule) => rule.active) ?? null;
  const history = rules.filter((rule) => !rule.active);

  const today = new Date().toISOString().slice(0, 10);
  const defaults = {
    name: active ? `${today} — from ${active.name}` : `${today} — launch`,
    baseFee: active ? dollars(active.baseFeeCents) : "29.00",
    perBag: active ? dollars(active.perBagCents) : "15.00",
    perKm: active ? String(Number(active.distanceMultiplier)) : "45",
    leadTimeCurve: active ? curveToText(active) : "10 1.4\n16 1.2\n24 1.1",
    discountRules: active
      ? JSON.stringify(active.discountRules, null, 2)
      : '[{ "kind": "family", "minBags": 3, "percent": 10 }]',
  };

  return (
    <ConsoleMain>
      <PageHeader
        title="Pricing"
        subtitle={
          unavailable
            ? "Database not configured."
            : active
              ? `Live: ${active.name} — $${dollars(active.baseFeeCents)} base, $${dollars(
                  active.perBagCents,
                )} a bag, ${Number(active.distanceMultiplier)}¢ per km`
              : "No active rule — every quote is refusing right now."
        }
      />

      {unavailable ? (
        <DatabaseNotConfigured />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {active ? "Publish a new rule" : "Publish the first rule"}
              </CardTitle>
              <CardDescription>
                {active
                  ? "Pre-filled from the live rule. Change what needs changing; the old one stays in the history and can be switched back to."
                  : "Nothing is priced until one rule is active. The values below are the launch defaults."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PublishPricingRuleForm defaults={defaults} />
            </CardContent>
          </Card>

          <section className="flex flex-col gap-3">
            {active ? (
              <Card>
                <CardHeader className="gap-1.5">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {active.name}
                    <Badge variant="success">Live</Badge>
                  </CardTitle>
                  <CardDescription>
                    In effect since {active.effectiveFrom.toISOString().slice(0, 10)} ·{" "}
                    {curveSummary(active)}
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : null}

            {history.length === 0 ? (
              <EmptyState
                title="No previous rules"
                description="Every rule you publish stays here. Nothing is ever deleted, so a price that turned out wrong is one click back."
              />
            ) : (
              history.map((rule) => (
                <Card key={rule.id}>
                  <CardHeader className="gap-1.5">
                    <CardTitle className="text-base">{rule.name}</CardTitle>
                    <CardDescription>
                      ${dollars(rule.baseFeeCents)} base · ${dollars(rule.perBagCents)} a
                      bag · {Number(rule.distanceMultiplier)}¢/km · {curveSummary(rule)}
                      <br />
                      Was live from {rule.effectiveFrom.toISOString().slice(0, 10)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ReactivateRuleForm id={rule.id} name={rule.name} />
                  </CardContent>
                </Card>
              ))
            )}
          </section>
        </div>
      )}
    </ConsoleMain>
  );
}

"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@koolee/ui";

/**
 * Verification checklist: verify ID → weigh → seal → photo → QR.
 *
 * A UI stub. Nothing is submitted yet — completing the checklist should call a
 * core service that, in one transaction, updates the task, writes the bag's
 * weight and seal id, appends a `booking.verified_sealed` custody event, and
 * transitions the booking. That service does not exist yet.
 *
 * TODO(agent-flow):
 *   · POST the completed checklist to a route handler that calls
 *     `applyTransitionForSession(config, session, { event: "complete_verification" })`
 *     together with the bag updates, in a single transaction.
 *   · Upload each photo to Supabase Storage and push the URL onto
 *     `bags.photo_urls`.
 *   · Decode the seal QR rather than typing it. `seal_id` stays an opaque
 *     string either way — the RFID-vs-QR decision does not change this
 *     component's output contract.
 *   · Offline queueing. An agent in a basement lobby with no signal must still
 *     be able to record custody; that needs an IndexedDB outbox and background
 *     sync, which the current service worker deliberately does not attempt.
 */

type StepId = "id" | "weigh" | "seal" | "photo" | "qr";

const STEPS: { id: StepId; title: string; detail: string }[] = [
  {
    id: "id",
    title: "Verify photo ID",
    detail: "The name on the ID must match the name on the booking.",
  },
  { id: "weigh", title: "Weigh each bag", detail: "Record the weight in kilograms." },
  { id: "seal", title: "Seal each bag", detail: "Attach a seal and record its ID." },
  { id: "photo", title: "Photograph each bag", detail: "Sealed, with the seal visible." },
  { id: "qr", title: "Scan the seal", detail: "Confirms the seal ID matches the bag." },
];

export function VerificationChecklist({
  bagCount,
  paxName,
}: {
  bagCount: number;
  paxName: string;
}) {
  const [done, setDone] = useState<Record<StepId, boolean>>({
    id: false,
    weigh: false,
    seal: false,
    photo: false,
    qr: false,
  });

  const completed = STEPS.filter((s) => done[s.id]).length;
  const allDone = completed === STEPS.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span>Verification</span>
          <Badge variant={allDone ? "success" : "secondary"}>
            {completed}/{STEPS.length}
          </Badge>
        </CardTitle>
        <CardDescription>
          Passenger: {paxName} · {bagCount} {bagCount === 1 ? "bag" : "bags"}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <ol className="flex flex-col divide-y">
          {STEPS.map((step, i) => (
            <li key={step.id} className="flex items-start gap-3 py-3">
              <input
                id={`step-${step.id}`}
                type="checkbox"
                checked={done[step.id]}
                onChange={(e) =>
                  setDone((prev) => ({ ...prev, [step.id]: e.target.checked }))
                }
                className="mt-1 size-4"
              />
              <label htmlFor={`step-${step.id}`} className="flex flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {i + 1}. {step.title}
                </span>
                <span className="text-xs text-muted-foreground">{step.detail}</span>
              </label>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-3 rounded-lg border border-dashed p-4">
          <span className="text-sm font-medium">Per-bag details</span>
          {Array.from({ length: bagCount }, (_, i) => (
            <div key={i} className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor={`weight-${i}`} className="text-xs">
                  Bag {i + 1} weight (kg)
                </Label>
                <Input id={`weight-${i}`} type="number" step="0.1" min="0" disabled />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`seal-${i}`} className="text-xs">
                  Bag {i + 1} seal ID
                </Label>
                <Input id={`seal-${i}`} placeholder="scan or type" disabled />
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Inputs are disabled until the submit path exists — see the TODO(agent-flow)
            block in this file.
          </p>
        </div>

        <Button disabled title="Submission is not implemented yet">
          {allDone ? "Complete verification" : "Complete all steps first"}
        </Button>
      </CardContent>
    </Card>
  );
}

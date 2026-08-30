"use client";

import * as React from "react";

import { useWebPush } from "../lib/use-web-push";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";
import { FormMessage } from "./form-message";

/**
 * "Turn on notifications" for the two staff apps.
 *
 * Lifted here rather than written twice: the agent app and the ops console
 * ask the same question, and the moment they diverge one of them quietly
 * stops handling a platform case the other handles (§7 — check packages/ui
 * before building a control, and lift it when a second app needs it). The
 * only difference between them is `verify`, below.
 *
 * THE ENABLE BUTTON IS THE ONLY WAY IN. Nothing here asks for permission on
 * mount. A dismissed prompt never returns on its own, so spending it on
 * someone who has not yet decided they want notifications costs them the
 * feature permanently — and Safari rejects a request that is not tied to a
 * click anyway.
 *
 * THE "DID YOU SEE IT?" STEP (`verify`) IS NOT CEREMONY. `showNotification`
 * resolving means the notification was CREATED, not displayed. macOS with the
 * browser switched off in System Settings reports success at every single
 * layer and draws nothing on screen; so does Focus, so does an alert style of
 * "None", so does an enterprise policy. There is no API on any platform that
 * reports it. Asking a human is the only detection that exists, which is why
 * Slack, Discord and Front all do exactly this.
 */

export interface PushEnableCardProps {
  /** `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, read by the app (see `useWebPush`). */
  vapidPublicKey?: string | undefined;
  /**
   * Send a real push through the FULL server pipeline.
   *
   * Returns `true` when the push service ACCEPTED it (never "delivered" —
   * there are no delivery receipts), or a reason string when nothing was
   * sent at all. Those are not the same failure and must not look the same:
   * "the server has no VAPID keys" is fixed in a dashboard, "you did not see
   * it" is fixed in System Settings, and sending somebody to the wrong one
   * wastes an afternoon.
   *
   * Given ⇒ the did-you-see-it step runs after enabling. Omitted for the ops
   * console: desktop staff sitting in front of the board all day have the
   * console itself as the channel, and the extra step buys less there than it
   * costs.
   */
  verify?: () => Promise<boolean | "not_configured" | "no_subscription">;
  title?: string;
  description?: React.ReactNode;
  className?: string;
}

type VerifyState =
  | "idle"
  | "sending"
  /** Sent and accepted. Now only a human can say whether it appeared. */
  | "asking"
  | "confirmed"
  /** A human said they saw nothing — the device is hiding it. */
  | "failed"
  /** NOTHING WAS SENT. A different problem with a different fix. */
  | "not_configured"
  | "no_subscription";

/**
 * What to try when somebody says they did NOT see the test notification.
 *
 * Every item here is a failure that is invisible to JavaScript — which is why
 * the list is static copy rather than something the page detects. Ordered by
 * how often it is the actual cause (from the POC's debugging notes).
 */
function remediationFor(browser: string, standalone: boolean): React.ReactNode {
  const isApple = browser.startsWith("Safari");
  const isIos = browser === "Safari (iOS)";

  if (isIos && !standalone) {
    return (
      <>
        On iPhone and iPad, notifications only work from the Home Screen app. Tap{" "}
        <strong>Share</strong>, then <strong>Add to Home Screen</strong>, open Koolee
        from the new icon, and turn notifications on there.
      </>
    );
  }

  return (
    <>
      The notification was sent and your browser accepted it, so something on this
      device is hiding it. In order of likelihood:
      <ol className="mt-2 ml-4 flex list-decimal flex-col gap-1">
        <li>
          <strong>Your Mac or PC is blocking {browser}.</strong> On macOS:{" "}
          System&nbsp;Settings → Notifications → {browser} → Allow notifications. You
          may need to quit {browser} completely and reopen it afterwards.
        </li>
        <li>
          <strong>Focus or Do Not Disturb is on.</strong> Notifications are being held
          rather than shown.
        </li>
        <li>
          <strong>The alert style is set to &ldquo;None&rdquo;.</strong> Check
          Notification Centre — if the test is sitting in there, everything works and
          only the on-screen banner was suppressed.
        </li>
        {isApple ? null : (
          <li>
            <strong>A work profile is blocking them.</strong> A managed browser can
            switch notifications off outright.
          </li>
        )}
      </ol>
    </>
  );
}

function PushEnableCard({
  vapidPublicKey,
  verify,
  title = "Notifications",
  description,
  className,
}: PushEnableCardProps) {
  const push = useWebPush({ vapidPublicKey });
  const [verifyState, setVerifyState] = React.useState<VerifyState>("idle");

  const runVerification = React.useCallback(async () => {
    if (!verify) return;
    setVerifyState("sending");
    const outcome = await verify().catch(() => false as const);
    if (outcome === "not_configured" || outcome === "no_subscription") {
      setVerifyState(outcome);
      return;
    }
    // "Accepted" is all the server can honestly report — a 201 from a push
    // service is not a delivery receipt. So the state is `asking`, never
    // `sent`.
    setVerifyState(outcome ? "asking" : "failed");
  }, [verify]);

  const onEnable = React.useCallback(async () => {
    const ok = await push.subscribe();
    if (ok && verify) void runVerification();
  }, [push, runVerification, verify]);

  const body = (): React.ReactNode => {
    if (!push.ready) {
      return <p className="text-sm text-muted-foreground">Checking this device…</p>;
    }

    if (push.diagnostics.blocker) {
      // Honest, not hopeful: naming the reason beats a disabled button that
      // looks broken.
      return <FormMessage variant="info">{push.diagnostics.blocker}</FormMessage>;
    }

    if (!vapidPublicKey) {
      return (
        <FormMessage variant="info">
          Notifications aren&apos;t configured on this environment yet.
        </FormMessage>
      );
    }

    if (!push.subscribed) {
      return (
        <div className="flex flex-col gap-3">
          <Button onClick={() => void onEnable()} disabled={push.busy}>
            {push.busy ? "Turning on…" : "Turn on notifications"}
          </Button>
          {push.permission === "denied" ? (
            <FormMessage variant="info">
              {push.diagnostics.browser} is blocking notifications for Koolee and
              won&apos;t ask again. Turn them back on in its site settings for this
              page, then try again.
            </FormMessage>
          ) : null}
          {push.error ? <FormMessage variant="error">{push.error}</FormMessage> : null}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          <span className="font-medium">On</span>{" "}
          <span className="text-muted-foreground">
            for {push.diagnostics.browser} on this device.
          </span>
        </p>

        {verifyState === "sending" ? (
          <p className="text-sm text-muted-foreground">Sending a test notification…</p>
        ) : null}

        {verifyState === "asking" ? (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium">Did a notification just appear?</p>
            <p className="text-sm text-muted-foreground">
              We sent one to this device. If nothing showed up, notifications
              won&apos;t reach you and we need to fix it now rather than during a
              pickup.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setVerifyState("confirmed");
                  void push.confirmSeen();
                }}
              >
                Yes, I saw it
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setVerifyState("failed")}
              >
                No, nothing appeared
              </Button>
            </div>
          </div>
        ) : null}

        {verifyState === "confirmed" ? (
          <FormMessage variant="success">
            Confirmed — notifications reach this device.
          </FormMessage>
        ) : null}

        {verifyState === "not_configured" ? (
          <FormMessage variant="error">
            Nothing was sent — notifications aren&apos;t set up on this
            environment yet, so there is nothing wrong with your device. This
            one is for whoever deploys Koolee, not for you.
          </FormMessage>
        ) : null}

        {verifyState === "no_subscription" ? (
          <FormMessage variant="error">
            This device isn&apos;t registered any more. Turn notifications off
            and on again.
          </FormMessage>
        ) : null}

        {verifyState === "failed" ? (
          <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            {remediationFor(push.diagnostics.browser, push.diagnostics.standalone)}
            <div>
              <Button size="sm" variant="ghost" onClick={() => void runVerification()}>
                Send another test
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {/* Available from every settled state, not just the first. Somebody
              who confirmed once still needs to re-check after changing a
              System Settings switch — and the previous version hid the button
              the moment they answered Yes. */}
          {verify &&
          (verifyState === "idle" ||
            verifyState === "confirmed" ||
            verifyState === "not_configured" ||
            verifyState === "no_subscription") ? (
            <Button size="sm" variant="ghost" onClick={() => void runVerification()}>
              Send a test notification
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void push.unsubscribe()}
            disabled={push.busy}
          >
            Turn off on this device
          </Button>
        </div>

        {push.error ? <FormMessage variant="error">{push.error}</FormMessage> : null}
      </div>
    );
  };

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{body()}</CardContent>
    </Card>
  );
}

export { PushEnableCard };

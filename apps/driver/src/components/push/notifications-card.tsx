import * as React from "react";
import { Linking, Platform, View } from "react-native";
import { useFocusEffect } from "expo-router";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormMessage,
  Text,
} from "@/components/ui";
import { ApiRequestError, NetworkError, TRANSPORT_FALLBACK } from "@/lib/api";
import {
  disablePush,
  enablePush,
  pushState,
  PushUnavailableError,
  sendTestPush,
  type PushState,
  type TestPushOutcome,
} from "@/push/notifications";

/**
 * Notifications, on the Account tab — the web agent app's `PushEnableCard`
 * (packages/ui/src/components/push-enable-card.tsx) for a phone. Same title,
 * same description, same "did you see it?" check, because the failures it
 * exists to catch are the same: Focus, a per-app switch, an alert style of
 * "None" — every layer reports success with the screen empty, so a person
 * is asked.
 *
 * Shown whether or not push is switched on for this environment (the web
 * hides it): a phone's permission is not spent by registering early, and the
 * test answers "not set up here yet" honestly when it is off.
 */
type Verify = "idle" | "sending" | TestPushOutcome | "confirmed";

export function NotificationsCard() {
  const [state, setState] = React.useState<PushState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [verify, setVerify] = React.useState<Verify>("idle");

  const reload = React.useCallback(async () => {
    try {
      setState(await pushState());
    } catch {
      setState({ permission: "undetermined", canAskAgain: true, registered: false });
    }
  }, []);

  // Re-read on every visit: the answer lives in Settings, and a driver who
  // went there to switch notifications on comes back to this tab.
  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload]),
  );

  const runTest = React.useCallback(async () => {
    setVerify("sending");
    setVerify(await sendTestPush());
  }, []);

  const onEnable = async () => {
    setBusy(true);
    setError(null);
    try {
      const permission = await enablePush();
      await reload();
      if (permission === "granted") void runTest();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const onDisable = async () => {
    setBusy(true);
    setError(null);
    await disablePush();
    setVerify("idle");
    await reload();
    setBusy(false);
  };

  const on = state?.permission === "granted" && state.registered;

  return (
    <Card testID="account-notifications">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Get told when a visit is assigned to you, or when a pickup lands on your shift —
          even with the app closed.
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        {state === null ? (
          <Text className="text-sm text-muted-foreground">Checking this phone…</Text>
        ) : !on ? (
          <>
            {state.permission === "denied" && !state.canAskAgain ? (
              <>
                <FormMessage variant="info">
                  Notifications are off for Koolee in Settings, and the phone won't ask
                  again. Turn them on there, then come back here.
                </FormMessage>
                <Button
                  variant="outline"
                  testID="notifications-settings"
                  onPress={() => void Linking.openSettings()}
                >
                  Open Settings
                </Button>
              </>
            ) : (
              <Button
                testID="notifications-enable"
                loading={busy}
                onPress={() => void onEnable()}
              >
                {busy ? "Turning on…" : "Turn on notifications"}
              </Button>
            )}
          </>
        ) : (
          <>
            <Text className="text-sm" testID="notifications-on">
              <Text weight="medium" className="text-sm">
                On
              </Text>{" "}
              <Text className="text-sm text-muted-foreground">for this phone.</Text>
            </Text>

            {verify === "sending" ? (
              <Text className="text-sm text-muted-foreground">
                Sending a test notification…
              </Text>
            ) : null}

            {verify === "asking" ? (
              <View
                testID="notifications-asking"
                className="gap-2 rounded-md border border-border p-3"
              >
                <Text weight="medium" className="text-sm">
                  Did a notification just appear?
                </Text>
                <Text className="text-sm text-muted-foreground">
                  We sent one to this phone. If nothing showed up, notifications won't
                  reach you and we need to fix it now rather than during a pickup.
                </Text>
                <View className="flex-row gap-2">
                  <Button
                    size="sm"
                    testID="notifications-seen"
                    onPress={() => setVerify("confirmed")}
                  >
                    Yes, I saw it
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    testID="notifications-not-seen"
                    onPress={() => setVerify("failed")}
                  >
                    No, nothing appeared
                  </Button>
                </View>
              </View>
            ) : null}

            {verify === "confirmed" ? (
              <FormMessage variant="success">
                Confirmed — notifications reach this phone.
              </FormMessage>
            ) : null}

            {verify === "not_configured" ? (
              <FormMessage variant="error">
                Nothing was sent — notifications aren't set up on this environment yet, so
                there is nothing wrong with your phone. This one is for whoever deploys
                Koolee, not for you.
              </FormMessage>
            ) : null}

            {verify === "setup" ? (
              <FormMessage variant="error">
                Nothing reached your phone — Koolee's push credentials aren't set up for
                this app yet. There is nothing to change on the phone; this one is for
                whoever builds the app.
              </FormMessage>
            ) : null}

            {verify === "no_subscription" ? (
              <FormMessage variant="error">
                This phone isn't registered any more. Turn notifications off and on again.
              </FormMessage>
            ) : null}

            {verify === "failed" ? (
              <View className="gap-2 rounded-md border border-warning/40 bg-warning/10 p-3">
                <Text className="text-sm text-foreground">
                  {Platform.OS === "ios"
                    ? "Check Settings → Notifications → Koolee Driver: Allow Notifications on, with Lock Screen and Banners ticked. A Focus or Do Not Disturb hides them too."
                    : "Check Settings → Apps → Koolee Driver → Notifications: on, and the Jobs category allowed to pop on screen. Do Not Disturb hides them too."}
                </Text>
                <View className="flex-row">
                  <Button size="sm" variant="ghost" onPress={() => void runTest()}>
                    Send another test
                  </Button>
                </View>
              </View>
            ) : null}

            <View className="flex-row flex-wrap gap-2">
              {verify === "idle" ||
              verify === "confirmed" ||
              verify === "not_configured" ||
              verify === "setup" ||
              verify === "no_subscription" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  testID="notifications-test"
                  onPress={() => void runTest()}
                >
                  Send a test notification
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                testID="notifications-disable"
                disabled={busy}
                onPress={() => void onDisable()}
              >
                Turn off on this phone
              </Button>
            </View>
          </>
        )}
        {error ? (
          <View testID="notifications-error">
            <FormMessage variant="error">{error}</FormMessage>
          </View>
        ) : null}
      </CardContent>
    </Card>
  );
}

function messageFor(error: unknown): string {
  if (error instanceof PushUnavailableError) return error.message;
  if (error instanceof ApiRequestError || error instanceof NetworkError) {
    return error.message;
  }
  return TRANSPORT_FALLBACK;
}

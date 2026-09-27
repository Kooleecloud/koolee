import * as React from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import Constants from "expo-constants";
import { useFocusEffect } from "expo-router";
import { Camera, LogOut } from "lucide-react-native";
import {
  apiRoutes,
  avatarResponseSchema,
  UPLOAD_BUCKETS,
  type MeResponse,
} from "@koolee/api-contract";

import { useMe, useSession } from "@/auth/session";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormMessage,
  Screen,
  Text,
} from "@/components/ui";
import { ApiRequestError, apiFetch, NetworkError } from "@/lib/api";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import {
  avatarKey,
  CameraPermissionError,
  capturePhoto,
  downscalePhoto,
  PhotoError,
  uploadPhoto,
} from "@/lib/photos";
import { queuedPositionCount } from "@/location/queue";
import {
  locationPermissionState,
  type LocationPermissionState,
} from "@/location/tracking";
import { onQueueChange, queuedActionCount } from "@/offline/actions";

/**
 * Account — who you are, and the way out. The web tab, card for card.
 *
 * Sign out lives here and nowhere else: on a phone the top-right is where a
 * thumb rests and where "back" lives in every other app a driver uses, and
 * ending a session mid-shift because you meant to go back is a bad afternoon.
 */
export default function AccountScreen() {
  const me = useMe();
  const { signOut } = useSession();
  const [permission, setPermission] = React.useState<LocationPermissionState | null>(
    null,
  );
  const [queuedPositions, setQueuedPositions] = React.useState<number | null>(null);
  const [queuedSteps, setQueuedSteps] = React.useState<number | null>(null);

  // Counts re-read every time the tab is shown: the location task and the
  // replay both write to the queues while this screen is not looking.
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      void locationPermissionState().then((state) => {
        if (!cancelled) setPermission(state);
      });
      void queuedPositionCount().then((n) => {
        if (!cancelled) setQueuedPositions(n);
      });
      void queuedActionCount().then((n) => {
        if (!cancelled) setQueuedSteps(n);
      });
      const unsubscribe = onQueueChange(setQueuedSteps);
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }, []),
  );

  const displayName = me.fullName ?? me.email ?? null;

  return (
    <Screen>
      <Text face="display" weight="semibold" className="text-3xl text-navy-800">
        Account
      </Text>

      <Card testID="account-identity">
        <CardHeader>
          <View className="flex-row items-center gap-3">
            <Avatar size="sm" name={displayName} src={me.avatarUrl} />
            <CardTitle className="flex-1" numberOfLines={1}>
              {me.fullName ?? me.email ?? "Signed in"}
            </CardTitle>
            <Badge variant="secondary">agent</Badge>
          </View>
          <CardDescription>
            Every seal, photo and hand-off you record is filed under this account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            size="lg"
            icon={<LogOut size={16} color="#0b2545" />}
            testID="sign-out"
            onPress={() => void signOut()}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>

      <Card testID="account-photo">
        <CardHeader>
          <CardTitle>Your photo</CardTitle>
          <CardDescription>
            Customers see this on their trip page before you arrive, so they know who to
            expect at the door.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AvatarUploader me={me} name={displayName} />
        </CardContent>
      </Card>

      {/* TODO(phase-5): Notifications card — native push registration
          (`POST /api/v1/push/register`) replaces the web's PushEnableCard.
          Sits above "Working offline" on purpose: it has an action, and the
          offline card is a statement of fact. */}

      <Card testID="account-location">
        <CardHeader>
          <CardTitle>Location</CardTitle>
          <CardDescription>
            {permission === "granted"
              ? "Always allowed — customers can see you even when the phone is locked."
              : permission === "foreground_only"
                ? 'Allowed only while the app is open. Choose "Always" in Settings to keep sharing from a locked phone.'
                : permission === "denied"
                  ? "Off. Turn it on in Settings so customers can see you coming."
                  : "Checking…"}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card testID="account-offline">
        <CardHeader>
          <CardTitle>Working offline</CardTitle>
          <CardDescription>
            Tasks and custody events need a connection. If you lose signal mid-visit, the
            step you were on is saved on this phone and sent when you have signal.
          </CardDescription>
          {queuedPositions !== null && queuedSteps !== null ? (
            <CardDescription testID="account-queued">
              {queuedPositions === 0 && queuedSteps === 0
                ? "Nothing is waiting to send."
                : `${plural(queuedPositions, "position")} and ${plural(queuedSteps, "step")} waiting for a signal.`}
            </CardDescription>
          ) : null}
        </CardHeader>
      </Card>

      <Text className="text-center text-xs text-muted-foreground">
        Koolee Driver {Constants.expoConfig?.version ?? ""} · {env.channel}
      </Text>
    </Screen>
  );
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/* --- the photo ------------------------------------------------------ */

const COPY = {
  tooLarge: (mb: number) => `That photo is too large — keep it under ${mb} MB.`,
  failed: "Something went wrong saving your photo. Please try again.",
};

/**
 * packages/ui `AvatarUploader` in its `overlay` layout: the avatar with a
 * camera badge on its corner and no visible label — the picture is not the
 * point of the card, the card is.
 *
 * The web picks a file; here the badge opens the camera, then the photo
 * goes straight to the `avatars` bucket under the driver's own session and
 * the object path is POSTed. The local preview is the DOWNSCALED file, so
 * what you see while it uploads is what gets stored; a failed save drops
 * it, because by then it is a lie about what is stored.
 */
function AvatarUploader({ me, name }: { me: MeResponse; name: string | null }) {
  const { refresh } = useSession();
  const [preview, setPreview] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onPick() {
    setError(null);
    setBusy(true);
    try {
      const captured = await capturePhoto();
      if (!captured) return;
      const resized = await downscalePhoto(captured.uri, captured.mimeType);
      const maxBytes = UPLOAD_BUCKETS.avatars.maxUploadBytes;
      if (resized.size > maxBytes) {
        setError(COPY.tooLarge(Math.floor(maxBytes / (1024 * 1024))));
        return;
      }
      setPreview(resized.uri);

      const target = avatarKey(me.userId, resized.mimeType);
      await uploadPhoto({ ...target, uri: resized.uri, contentType: resized.mimeType });
      await apiFetch(avatarResponseSchema, apiRoutes.accountAvatar(), {
        method: "POST",
        body: { storagePath: target.path },
        idempotencyKey: newId(),
      });
      // /me carries the new signed URL; once it is in, the preview is
      // redundant. `refresh` swallows a transport failure and answers null —
      // the photo IS saved by now, so the preview stays up rather than
      // snapping back to the old one.
      if (await refresh()) setPreview(null);
    } catch (err) {
      setPreview(null);
      if (
        err instanceof CameraPermissionError ||
        err instanceof PhotoError ||
        err instanceof ApiRequestError ||
        err instanceof NetworkError
      ) {
        setError(err.message);
      } else {
        console.warn("[account] avatar upload failed", err);
        setError(COPY.failed);
      }
    } finally {
      setBusy(false);
    }
  }

  const shown = preview ?? me.avatarUrl ?? null;
  const pickLabel = shown ? "Change photo" : "Add a photo";

  return (
    <View className="items-center gap-2">
      <View>
        <Avatar size="xl" name={name} src={shown} testID="account-avatar" />
        {/* Solid at rest, where the web is quiet-at-rest and solid on hover:
            there is no hover here, and a bare navy glyph over a dark photo
            is invisible without the web's drop shadow (no SVG filters on
            native). */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pickLabel}
          accessibilityState={{ disabled: busy, busy }}
          disabled={busy}
          testID="avatar-change"
          onPress={() => void onPick()}
          className={`absolute -right-1 -top-1 h-8 w-8 items-center justify-center rounded-full border border-border bg-background ${busy ? "opacity-60" : "active:bg-muted"}`}
          style={{
            shadowColor: "#0b2545",
            shadowOpacity: 0.08,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 2 },
            elevation: 2,
          }}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#0b2545" />
          ) : (
            <Camera size={16} color="#0b2545" />
          )}
        </Pressable>
      </View>
      {error ? <FormMessage variant="error">{error}</FormMessage> : null}
    </View>
  );
}

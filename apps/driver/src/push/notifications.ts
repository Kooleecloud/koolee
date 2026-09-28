import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import {
  apiRoutes,
  pushRegisterResponseSchema,
  pushTestResponseSchema,
  pushUnregisterResponseSchema,
} from "@koolee/api-contract";

import { apiFetch, ApiRequestError } from "@/lib/api";

/**
 * Expo push for the driver app — the second channel beside the web agent
 * app's web push (decision 9). The phone holds an Expo push token; the
 * server keeps it in `driver_push_tokens` and the relay reaches APNs/FCM.
 *
 * WHEN THE APP ASKS. Only from the Account tab's "Turn on notifications",
 * exactly as the web does: the OS prompt is one-shot, and spending it at a
 * moment the driver did not choose is how it gets refused. Once allowed, the
 * token is re-registered silently on every signed-in launch — tokens rotate,
 * and a phone that changed hands moves to whoever signs in (the server's
 * upsert does that).
 */

/**
 * The Android channel every push lands in. Must match core's
 * `ANDROID_CHANNEL_ID` (notifications/expo-push.ts) and app.json's
 * `defaultChannel`: Android 8+ drops a notification whose channel does not
 * exist.
 */
export const ANDROID_CHANNEL_ID = "default";

/** The registered token, so sign-out can remove exactly this phone. */
const STORED_TOKEN_KEY = "koolee.push.token";

// Shown while the app is open, too: a job assigned mid-visit is exactly when
// the driver is looking at the screen and needs to hear about it.
Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
});

export type PushPermission = "granted" | "denied" | "undetermined";

export interface PushState {
  permission: PushPermission;
  /** False once the OS will not show the prompt again — Settings only. */
  canAskAgain: boolean;
  /** This phone's token is registered with Koolee. */
  registered: boolean;
}

/** Why a token could not be had — said to the driver in these words. */
export class PushUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "PushUnavailableError";
  }
}

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as
    { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  // Created BEFORE the permission request: on Android 13+ the prompt only
  // appears once a channel exists.
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "Jobs",
    description: "New visits and pickups, and when Koolee can't see your location.",
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: "#0B2545",
    vibrationPattern: [0, 250, 250, 250],
  });
}

async function storedToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORED_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function pushState(): Promise<PushState> {
  const settings = await Notifications.getPermissionsAsync();
  return {
    permission: settings.status as PushPermission,
    canAskAgain: settings.canAskAgain,
    registered: (await storedToken()) !== null,
  };
}

/**
 * The Expo token for this install. The two failures that are not the
 * driver's — a build without push credentials (no Firebase config on
 * Android; no APNs key in the EAS project on iOS) — come back as a sentence
 * saying so, instead of a stack trace or a button that silently does nothing.
 */
async function expoToken(): Promise<string> {
  const id = projectId();
  if (!id) {
    throw new PushUnavailableError(
      "This build isn't linked to Koolee's push service yet. It's a setup step for whoever builds the app.",
    );
  }
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    return data;
  } catch (error) {
    if (__DEV__) console.warn("[push] no Expo token", error);
    // Missing Firebase (Android) or APNs (iOS) setup is the build's, on any
    // device — an emulator with Google Play gets a token once Firebase is
    // configured. Only an unexplained failure on a simulator blames the
    // simulator.
    const text = error instanceof Error ? error.message : String(error);
    const setup = /firebase|googleservices|fcm|apns|aps-environment/i.test(text);
    throw new PushUnavailableError(
      setup || Device.isDevice
        ? "Notifications need one more setup step on Koolee's side before this phone can get them. Nothing to change on the phone."
        : "Push notifications need a real phone: this simulator couldn't get a push token.",
      error,
    );
  }
}

async function register(token: string): Promise<void> {
  await apiFetch(pushRegisterResponseSchema, apiRoutes.pushRegister(), {
    method: "POST",
    body: {
      token,
      platform: Platform.OS === "ios" ? "ios" : "android",
      ...(Device.modelName ? { deviceLabel: Device.modelName.slice(0, 120) } : {}),
    },
  });
  try {
    await AsyncStorage.setItem(STORED_TOKEN_KEY, token);
  } catch {
    // Only sign-out's cleanup reads this; the server holds the truth.
  }
}

/**
 * "Turn on notifications": the OS prompt if it can still be shown, then the
 * token, then Koolee. Returns the permission the OS settled on; throws
 * `PushUnavailableError` (or the API's refusal) when the phone said yes but
 * there is nothing to register.
 */
export async function enablePush(): Promise<PushPermission> {
  await ensureChannel();
  let settings = await Notifications.getPermissionsAsync();
  if (settings.status !== "granted" && settings.canAskAgain) {
    settings = await Notifications.requestPermissionsAsync();
  }
  if (settings.status !== "granted") return settings.status as PushPermission;
  await register(await expoToken());
  return "granted";
}

/**
 * The silent half: on every signed-in launch, re-register if — and only if —
 * the driver already allowed notifications. Never prompts, never throws.
 */
export async function syncPushRegistration(): Promise<void> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (settings.status !== "granted") return;
    await ensureChannel();
    await register(await expoToken());
  } catch (error) {
    if (__DEV__) console.warn("[push] silent re-register skipped", error);
  }
}

/**
 * "Turn off on this phone", and sign-out. Best effort: the server also
 * disables a token the relay reports dead, and a phone that signs in as
 * somebody else moves the token to them anyway.
 */
export async function disablePush(): Promise<void> {
  const token = await storedToken();
  if (!token) return;
  try {
    await apiFetch(pushUnregisterResponseSchema, apiRoutes.pushRegister(), {
      method: "DELETE",
      body: { token },
    });
  } catch (error) {
    if (__DEV__) console.warn("[push] unregister failed", error);
  }
  try {
    await AsyncStorage.removeItem(STORED_TOKEN_KEY);
  } catch {
    // Nothing to do: the next register overwrites it.
  }
}

export type TestPushOutcome =
  | "asking"
  | "not_configured"
  | "no_subscription"
  /** The relay refused for want of Koolee's credentials — not the phone. */
  | "setup"
  /** Nothing explains it but the phone: Settings, Focus, Do Not Disturb. */
  | "failed";

/**
 * A REAL push through Koolee's server and the relay, for "did you see it?".
 * `asking`, never "sent": the relay taking a message is not a delivery, so a
 * person is asked next.
 */
export async function sendTestPush(): Promise<TestPushOutcome> {
  try {
    const { accepted, failure } = await apiFetch(
      pushTestResponseSchema,
      apiRoutes.pushTest(),
      { method: "POST", body: {} },
    );
    if (accepted) return "asking";
    if (failure === "setup") return "setup";
    if (failure === "device") return "no_subscription";
    return "failed";
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.code === "not_configured") return "not_configured";
      if (error.code === "no_subscription") return "no_subscription";
    }
    return "failed";
  }
}

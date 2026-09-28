import "react-native-url-polyfill/auto";
import "react-native-get-random-values";

import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as aesjs from "aes-js";
import * as SecureStore from "expo-secure-store";
import { createClient, isAuthRetryableFetchError } from "@supabase/supabase-js";

import { env } from "./env";

/**
 * Supabase for the driver app: email + password, the same accounts as the
 * web agent app, ANON KEY ONLY. The session (access + refresh token) is the
 * bearer credential every `/api/v1` call carries, so where it is stored
 * matters.
 *
 * SecureStore is the right vault but historically refuses values over ~2 KB
 * on iOS, and a Supabase session is bigger than that. This is the adapter the
 * Supabase React Native guide ships: a random AES key per entry lives in
 * SecureStore (small), the encrypted session lives in AsyncStorage (large).
 * Losing the phone yields ciphertext without its key.
 */
class LargeSecureStore {
  private async encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async decrypt(key: string, value: string): Promise<string | null> {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1),
    );
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));
    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;
    return this.decrypt(key, encrypted);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this.encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }
}

export const supabase = createClient(
  env.supabaseUrl || "http://localhost:54321",
  env.supabaseAnonKey || "anon",
  {
    auth: {
      storage: new LargeSecureStore(),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

/*
 * The refresh timer only needs to run while the app is in front; a background
 * location wake fetches a fresh token on demand through getSession() instead.
 * This is the pattern from the Supabase React Native reference.
 */
AppState.addEventListener("change", (state) => {
  if (state === "active") void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});

/**
 * What the app holds for `/api/v1` right now.
 *
 * THREE STATES, because two of them look identical from `getSession()`. Past
 * its real expiry an access token has to be refreshed before it can be sent,
 * and a refresh needs the network: offline, supabase-js answers "no session"
 * AND a retryable fetch error, while keeping the session in storage for the
 * next attempt. Read as "signed out", that became a local 401 before any
 * request left the phone — and the position queue drops a batch on a 4xx, so
 * an hour in a car park with an expired token threw the whole backlog away.
 * It is `offline`: keep everything, try again when there is signal.
 */
export type TokenResult =
  { token: string } | { token: null; reason: "signed_out" | "offline" };

export async function accessTokenResult(): Promise<TokenResult> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (session) return { token: session.access_token };
  if (error && isAuthRetryableFetchError(error))
    return { token: null, reason: "offline" };
  return { token: null, reason: "signed_out" };
}

/** The bearer token for `/api/v1`, or null when there is none to send. */
export async function accessToken(): Promise<string | null> {
  const result = await accessTokenResult();
  return result.token;
}

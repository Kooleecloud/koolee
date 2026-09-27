import { decode } from "base64-arraybuffer";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat, type ImageRef } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import {
  avatarPath,
  bagPhotoPath,
  IMAGE_MIME_TYPES,
  passportPhotoPath,
  UPLOAD_BUCKETS,
  type ImageMimeType,
} from "@koolee/api-contract";

import { NetworkError } from "./api";
import { newId } from "./ids";
import { supabase } from "./supabase";

/**
 * Photos: capture, shrink, upload.
 *
 * The web app posted a `File` through a Server Action; here the app uploads
 * straight to Storage under the driver's JWT and then POSTs the object path.
 * The downscale rule is the web's (`@koolee/ui/lib/photo`): longest edge
 * 1600 px, JPEG, quality stepped down until the file is under ~700 KB. An
 * evidence photo only has to be legible, and a 6 MB capture over a parking
 * garage's one bar of signal is how a seal step stays "sending" forever.
 */

/** Longest edge of the resized image, in pixels. */
const MAX_EDGE = 1600;
/** Target upload size. */
const TARGET_BYTES = 700 * 1024;
/** JPEG qualities tried in order until the result fits TARGET_BYTES. */
const QUALITIES = [0.8, 0.6, 0.45];

export type UploadBucket = (typeof UPLOAD_BUCKETS)[keyof typeof UPLOAD_BUCKETS]["bucket"];

/** Where an object goes: the bucket and the full key under its prefix. */
export interface UploadTarget {
  bucket: UploadBucket;
  path: string;
}

export interface CapturedPhoto {
  uri: string;
  /** What the picker said, when it is a type the buckets take; null otherwise. */
  mimeType: ImageMimeType | null;
  width: number;
  height: number;
}

export interface PreparedPhoto extends Omit<CapturedPhoto, "mimeType"> {
  /** Always one the buckets accept: the downscale re-encodes anything else. */
  mimeType: ImageMimeType;
  /** Bytes on disk after the downscale. */
  size: number;
}

/** The driver refused the camera. Only Settings can change it now. */
export class CameraPermissionError extends Error {
  constructor() {
    super("Allow camera access in Settings to take a photo.");
    this.name = "CameraPermissionError";
  }
}

/** Something about the photo itself, not the connection. Safe to show. */
export class PhotoError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PhotoError";
    this.cause = cause;
  }
}

function asImageMime(value: string | undefined): ImageMimeType | null {
  // The picker re-encodes to JPEG on both platforms unless told otherwise,
  // but a missing type is what Android returns for some content providers
  // and `image/heic` is what an iPhone can hand over from the library. Null
  // means "not one of ours": the downscale then always re-encodes, rather
  // than an "already small" HEIC going up labelled as a JPEG.
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value ?? "")
    ? (value as ImageMimeType)
    : null;
}

export interface CaptureOptions {
  /** Camera (the default) or the photo library — the avatar allows either. */
  camera?: boolean;
  /** Picker-side JPEG quality, 0–1. The downscale below does the real work. */
  quality?: number;
}

/**
 * Opens the camera (or library) and resolves with the capture, or null when
 * the driver backed out. A refused permission throws `CameraPermissionError`
 * rather than resolving null: backing out is nothing to say, a refusal is.
 */
export async function capturePhoto(
  options: CaptureOptions = {},
): Promise<CapturedPhoto | null> {
  const { camera = true, quality = 0.8 } = options;
  const picker = {
    mediaTypes: ["images" as const],
    allowsEditing: false,
    quality,
    exif: false,
  };

  let result: ImagePicker.ImagePickerResult;
  if (camera) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new CameraPermissionError();
    result = await ImagePicker.launchCameraAsync(picker);
  } else {
    result = await ImagePicker.launchImageLibraryAsync(picker);
  }
  if (result.canceled) return null;

  const asset = result.assets[0];
  if (!asset) return null;
  return {
    uri: asset.uri,
    mimeType: asImageMime(asset.mimeType),
    width: asset.width,
    height: asset.height,
  };
}

function fileSize(uri: string): number {
  try {
    return new File(uri).size;
  } catch {
    return 0;
  }
}

function release(ref: ImageRef | null): void {
  try {
    ref?.release();
  } catch {
    // A ref the runtime already collected. Nothing to free.
  }
}

/**
 * Shrinks a capture to the upload size. Always comes back as JPEG: iPhones
 * hand over HEIC when they can, which the buckets do not accept, so the
 * re-encode is not only about bytes.
 *
 * The "already small" shortcut is the web's, kept for the same reason — no
 * point losing detail for nothing — but only when the input is already a
 * JPEG, for the reason above.
 */
export async function downscalePhoto(
  uri: string,
  mimeType: ImageMimeType | null = null,
): Promise<PreparedPhoto> {
  const originalSize = fileSize(uri);

  let rendered: ImageRef | null = null;
  try {
    const context = ImageManipulator.manipulate(uri);
    rendered = await context.renderAsync();
    const { width, height } = rendered;

    if (mimeType === "image/jpeg" && originalSize > 0 && originalSize <= TARGET_BYTES) {
      return { uri, mimeType, width, height, size: originalSize };
    }

    const scale = Math.min(1, MAX_EDGE / Math.max(width, height, 1));
    if (scale < 1) {
      release(rendered);
      rendered = await context
        .resize({ width: Math.max(1, Math.round(width * scale)) })
        .renderAsync();
    }

    let best: PreparedPhoto | null = null;
    for (const quality of QUALITIES) {
      const saved = await rendered.saveAsync({
        compress: quality,
        format: SaveFormat.JPEG,
      });
      best = {
        uri: saved.uri,
        mimeType: "image/jpeg",
        width: saved.width,
        height: saved.height,
        size: fileSize(saved.uri),
      };
      if (best.size > 0 && best.size <= TARGET_BYTES) break;
    }
    if (!best) throw new PhotoError("Could not prepare that photo. Take it again.");
    return best;
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    throw new PhotoError("Could not prepare that photo. Take it again.", error);
  } finally {
    release(rendered);
  }
}

/** Capture then downscale — what a step screen actually calls. */
export async function takePhoto(
  options: CaptureOptions = {},
): Promise<PreparedPhoto | null> {
  const captured = await capturePhoto(options);
  if (!captured) return null;
  return downscalePhoto(captured.uri, captured.mimeType);
}

export interface UploadPhotoInput extends UploadTarget {
  uri: string;
  contentType: ImageMimeType;
}

function isDuplicate(error: { statusCode?: unknown; message: string }): boolean {
  return String(error.statusCode) === "409" || /already exists/i.test(error.message);
}

function looksLikeTransport(error: { name?: string; message: string }): boolean {
  return (
    error.name === "StorageUnknownError" ||
    /network|fetch|connection|timed out|ECONN/i.test(error.message)
  );
}

/**
 * Puts the file in Storage. Throws `NetworkError` when the connection is the
 * problem — the offline queue keeps the step and retries — and `PhotoError`
 * when the photo or the bucket is.
 *
 * `upsert: false` because a key is minted per capture and never reused. The
 * one way a key collides is a replay whose first attempt uploaded the object
 * and then lost the POST; the object there IS this photo, so a 409 from the
 * bucket counts as uploaded.
 */
export async function uploadPhoto(input: UploadPhotoInput): Promise<{ path: string }> {
  let base64: string;
  try {
    base64 = await new File(input.uri).base64();
  } catch (error) {
    throw new PhotoError("That photo is no longer on this phone. Take it again.", error);
  }

  const { error } = await supabase.storage
    .from(input.bucket)
    .upload(input.path, decode(base64), {
      contentType: input.contentType,
      upsert: false,
    });

  if (error) {
    if (isDuplicate(error)) return { path: input.path };
    if (looksLikeTransport(error)) throw new NetworkError(error);
    throw new PhotoError(error.message, error);
  }
  return { path: input.path };
}

/** A fresh passport key for this booking. A retake is a NEW object. */
export function passportPhotoKey(bookingId: string, mime: ImageMimeType): UploadTarget {
  return {
    bucket: UPLOAD_BUCKETS.passportPhotos.bucket,
    path: passportPhotoPath(bookingId, newId(), mime),
  };
}

export function bagPhotoKey(bagId: string, mime: ImageMimeType): UploadTarget {
  return {
    bucket: UPLOAD_BUCKETS.bagPhotos.bucket,
    path: bagPhotoPath(bagId, newId(), mime),
  };
}

export function avatarKey(userId: string, mime: ImageMimeType): UploadTarget {
  return {
    bucket: UPLOAD_BUCKETS.avatars.bucket,
    path: avatarPath(userId, newId(), mime),
  };
}

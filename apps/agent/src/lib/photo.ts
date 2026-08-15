/**
 * Client-side photo downscaling for the visit flow.
 *
 * Phone cameras hand us 3–8 MB JPEGs. Server Actions cap the request body at
 * 1 MB by default (and Vercel's serverless request body is hard-capped at
 * ~4.5 MB, which `serverActions.bodySizeLimit` cannot raise), so an untouched
 * camera capture fails with a 413 before the action ever runs. We resize in
 * the browser instead: a bag photo only has to show the bag and its seal.
 *
 * Everything here is best-effort. If the browser can't decode or encode, we
 * return the original file and let the server-side size/type checks decide.
 */

/** Longest edge of the resized image, in pixels. */
const MAX_EDGE = 1600;
/** Target upload size. Well under the 1 MB Server Action body limit. */
const TARGET_BYTES = 700 * 1024;
/** JPEG qualities tried in order until the result fits TARGET_BYTES. */
const QUALITIES = [0.8, 0.6, 0.45];

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

export async function downscalePhoto(file: File): Promise<File> {
  // Already small enough — don't re-encode and lose detail for nothing.
  if (file.size <= TARGET_BYTES) return file;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    return file;
  }

  try {
    // `from-image` applies the EXIF orientation, so portrait captures don't
    // come out sideways once the tag is dropped by the re-encode.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    let best: Blob | null = null;
    for (const quality of QUALITIES) {
      const blob = await canvasToBlob(canvas, quality);
      if (!blob) break;
      best = blob;
      if (blob.size <= TARGET_BYTES) break;
    }
    // Only swap if we actually helped.
    if (!best || best.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([best], `${name}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@koolee/ui";

type CameraState =
  | { kind: "idle" }
  | { kind: "unsupported"; reason: string }
  | { kind: "requesting" }
  | { kind: "live" }
  | { kind: "denied"; reason: string };

/**
 * Camera-permission-ready capture stub.
 *
 * Degrades in three ways, all of them non-fatal:
 *  - no `mediaDevices` (http:// on a LAN IP, old browser) → explain and offer
 *    the file-input fallback, which uses the OS camera on mobile;
 *  - permission denied → same fallback;
 *  - permission granted → live preview and a still capture into a data URL.
 *
 * TODO: decode the QR / seal ID from the captured frame once the seal
 * technology is chosen (RFID vs QR still open). `seal_id` stays an opaque
 * string either way, so this component's output contract will not change.
 * TODO: upload captured stills to Supabase Storage and attach the resulting
 * URL to `bags.photo_urls` via a core service.
 */
export function CameraCapture() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [state, setState] = useState<CameraState>({ kind: "idle" });
  const [snapshot, setSnapshot] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState({
        kind: "unsupported",
        reason:
          "This browser will not expose a camera here. Cameras require HTTPS (or localhost).",
      });
      return;
    }

    setState({ kind: "requesting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState({ kind: "live" });
    } catch (error: unknown) {
      stop();
      setState({
        kind: "denied",
        reason: error instanceof Error ? error.message : "Camera permission was refused.",
      });
    }
  }, [stop]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setSnapshot(canvas.toDataURL("image/jpeg", 0.85));
  }, []);

  const onFilePicked = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSnapshot(String(reader.result));
    reader.readAsDataURL(file);
  }, []);

  const degraded = state.kind === "unsupported" || state.kind === "denied";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Camera</CardTitle>
        <CardDescription>
          Capture a bag photo or scan a seal. Nothing is uploaded yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="relative aspect-3/4 overflow-hidden rounded-lg bg-muted">
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover"
            hidden={state.kind !== "live"}
          />
          {state.kind !== "live" && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">
              {state.kind === "requesting"
                ? "Waiting for camera permission…"
                : degraded
                  ? state.reason
                  : "Camera is off."}
            </div>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />

        <div className="flex flex-wrap gap-2">
          {state.kind !== "live" ? (
            <Button onClick={() => void start()} disabled={state.kind === "requesting"}>
              {state.kind === "requesting" ? "Requesting…" : "Start camera"}
            </Button>
          ) : (
            <>
              <Button onClick={capture}>Capture</Button>
              <Button
                variant="outline"
                onClick={() => {
                  stop();
                  setState({ kind: "idle" });
                }}
              >
                Stop
              </Button>
            </>
          )}

          <Button asChild variant="secondary">
            <label className="cursor-pointer">
              Use device camera
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={onFilePicked}
              />
            </label>
          </Button>
        </div>

        {snapshot && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Captured</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={snapshot}
              alt="Captured bag photo"
              className="w-full rounded-lg border"
            />
            <Button variant="ghost" size="sm" onClick={() => setSnapshot(null)}>
              Discard
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

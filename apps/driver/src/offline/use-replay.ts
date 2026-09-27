import * as React from "react";
import { AppState } from "react-native";
import { addNetworkStateListener } from "expo-network";
import { useQueryClient } from "@tanstack/react-query";

import { keys } from "../lib/queries";
import {
  onQueueChange,
  queuedActionCount,
  replayActions,
  type ActionFailure,
  type ReplayResult,
} from "./actions";

export interface UseReplayOptions {
  /** A queued step the server refused. The screen toasts it. */
  onActionFailed?: (failure: ActionFailure) => void;
}

export interface ReplayState {
  /** Steps still waiting on this phone. */
  queued: number;
  replaying: boolean;
  replay: () => Promise<ReplayResult>;
}

/**
 * Replays the queue when a signal comes back and when the app returns to the
 * foreground, then invalidates the tasks list so the screens read what the
 * server now believes. Mounted once, in the tab layout; screens read
 * `queued` to say "2 steps waiting for a signal".
 *
 * BOTH TRIGGERS, because neither alone is enough: the network listener does
 * not fire while iOS has the app suspended, and coming to the foreground
 * with a signal that never dropped still means a replay may have been cut
 * short last time the app was killed.
 */
export function useReplay(options: UseReplayOptions = {}): ReplayState {
  const qc = useQueryClient();
  const [queued, setQueued] = React.useState(0);
  const [replaying, setReplaying] = React.useState(false);

  // The latest callback without re-subscribing the listeners on each render.
  const onFailed = React.useRef(options.onActionFailed);
  React.useEffect(() => {
    onFailed.current = options.onActionFailed;
  });

  const replay = React.useCallback(async () => {
    setReplaying(true);
    try {
      const result = await replayActions({
        onActionFailed: (failure) => onFailed.current?.(failure),
      });
      if (result.replayed > 0 || result.failed > 0) {
        // The list first, then everything else: a replayed step changed the
        // task it belonged to, and the detail keys are the screens' own.
        void qc.invalidateQueries({ queryKey: keys.tasks });
        void qc.invalidateQueries();
      }
      return result;
    } finally {
      setReplaying(false);
    }
  }, [qc]);

  // The listeners fire-and-forget; a replay that throws (the database itself
  // failing to open) must not become an unhandled rejection with no trace.
  const replayInBackground = React.useCallback(() => {
    replay().catch((error: unknown) => {
      console.warn("[offline] replay failed", error);
    });
  }, [replay]);

  React.useEffect(() => {
    let cancelled = false;
    void queuedActionCount().then((n) => {
      if (!cancelled) setQueued(n);
    });
    const unsubscribe = onQueueChange(setQueued);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  React.useEffect(() => {
    let wasOnline: boolean | null = null;
    const network = addNetworkStateListener(({ isConnected, isInternetReachable }) => {
      const online = isConnected === true && isInternetReachable !== false;
      if (online && wasOnline === false) replayInBackground();
      wasOnline = online;
    });
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") replayInBackground();
    });
    // Whatever was left from the last time the app was killed mid-replay.
    void queuedActionCount().then((n) => {
      if (n > 0) replayInBackground();
    });
    return () => {
      network.remove();
      app.remove();
    };
  }, [replayInBackground]);

  return { queued, replaying, replay };
}

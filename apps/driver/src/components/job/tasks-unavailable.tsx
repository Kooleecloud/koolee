import { CloudOff } from "lucide-react-native";

import { Button, EmptyState } from "@/components/ui";
import { ApiRequestError, NetworkError } from "@/lib/api";

/**
 * The tasks list could not be read and there is nothing cached to show.
 *
 * The web's twin is `DatabaseNotConfigured`, which is a server-side panel
 * about env vars; on a phone the reason is almost always the signal, so this
 * says that, and shows the server's own words when it did answer.
 */
export function unavailableMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof NetworkError) return "Check your connection and try again.";
  return "Something went wrong. Try again in a moment.";
}

export function TasksUnavailable({
  error,
  onRetry,
  retrying = false,
}: {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <EmptyState
      testID="tasks-unavailable"
      icon={<CloudOff size={32} color="#58687e" />}
      title="Can't reach the server"
      description={unavailableMessage(error)}
      action={
        <Button
          variant="outline"
          loading={retrying}
          testID="tasks-retry"
          onPress={onRetry}
        >
          Try again
        </Button>
      }
    />
  );
}

import * as React from "react";
import { cn } from "@koolee/ui";

import { OfflineNotice } from "./offline-notice";

/**
 * The agent app's content column.
 *
 * Diverges from the shared `ContentColumn` for the same reason admin's does —
 * a different reader. `ContentColumn` centres inside a 1280px container with
 * `py-10`; this app runs on a 393px screen held at arm's length, so it caps at
 * a phone-ish measure, tightens the top padding, and reserves the bottom for
 * the tab bar plus the home indicator.
 *
 * `pb-24` is not decoration: without it the last card in a list sits under the
 * fixed tab bar and cannot be tapped.
 */
export interface AgentMainProps extends React.HTMLAttributes<HTMLElement> {
  /** Drops the bottom reserve — for screens with no tab bar (auth, offline). */
  bare?: boolean;
}

export function AgentMain({
  bare = false,
  className,
  children,
  ...props
}: AgentMainProps) {
  return (
    <main
      className={cn(
        "mx-auto flex w-full max-w-lg flex-col gap-4 px-4 pt-5",
        bare ? "pb-10" : "pb-24",
        className,
      )}
      {...props}
    >
      {/* Above everything, on every screen with a tab bar. A driver reading a
          stale stop list with no idea it is stale will act on it. Renders
          nothing while online — see the component. */}
      {!bare && <OfflineNotice />}
      {children}
    </main>
  );
}

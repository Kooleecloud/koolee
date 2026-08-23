"use client";

import { ConfirmDialog } from "@koolee/ui";

/**
 * A destructive server action behind a confirmation dialog.
 *
 * One shared component so every draft-discarding surface (the stepper's
 * "Start over", the dead-end window card, My Trips "Discard") behaves and
 * looks the same.
 *
 * This used to call `window.confirm`. That popup is the browser's, not ours:
 * unstyled, unbranded, differently worded on every platform, impossible to
 * test, and on mobile it renders as a system sheet that looks like the page
 * has been interrupted by the OS. Every confirmation in the product now goes
 * through the same `ConfirmDialog` — the one admin already uses for custody
 * overrides — so a customer discarding a draft and an operator forcing a
 * transition meet the same component.
 *
 * The action is invoked directly on confirm rather than through a real form
 * submit: `ConfirmDialog` owns the busy state and keeps itself open until the
 * promise settles, which a form submit cannot report back.
 */
export function ConfirmActionForm({
  action,
  title,
  description,
  confirmLabel,
  destructive = true,
  className,
  children,
}: {
  action: () => Promise<void>;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  /** These are all discards today; kept as a prop for non-destructive reuse. */
  destructive?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <ConfirmDialog
        trigger={children}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        destructive={destructive}
        onConfirm={action}
      />
    </div>
  );
}

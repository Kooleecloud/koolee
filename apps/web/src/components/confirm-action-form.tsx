"use client";

/**
 * A form for destructive server actions: asks for confirmation before
 * submitting. One shared component so every draft-discarding surface
 * (stepper "Start over", dead-end cards, My Trips "Discard") behaves the
 * same way.
 */
export function ConfirmActionForm({
  action,
  message,
  className,
  children,
}: {
  action: () => Promise<void>;
  message: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </form>
  );
}

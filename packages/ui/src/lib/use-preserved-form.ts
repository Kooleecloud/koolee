"use client";

import * as React from "react";

/**
 * Keeps what the user typed when a form action fails.
 *
 * React 19 resets uncontrolled form fields after a form action completes —
 * so a failed validation would wipe the whole form and make the user retype
 * everything. This hook snapshots the form's values at submit time and, when
 * the action returns an error, restores them.
 *
 * Deliberately skipped on restore: password fields (standard security
 * convention), file inputs (cannot be set programmatically), and hidden
 * fields (tokens like Turnstile must be re-minted, not replayed).
 *
 * Usage:
 *   const { formRef, captureValues } = usePreservedFormValues(state);
 *   <form ref={formRef} action={formAction} onSubmit={captureValues}>
 */
export function usePreservedFormValues(
  state: unknown,
  /** Override for states that signal failure differently than `.error`. */
  failed?: boolean,
): {
  formRef: React.RefObject<HTMLFormElement | null>;
  captureValues: () => void;
} {
  const hasError =
    failed ?? Boolean((state as { error?: string | undefined } | null)?.error);
  const formRef = React.useRef<HTMLFormElement>(null);
  const snapshot = React.useRef<Map<string, string[]>>(new Map());

  const captureValues = React.useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const map = new Map<string, string[]>();
    for (const key of new Set(data.keys())) {
      map.set(
        key,
        data.getAll(key).filter((v): v is string => typeof v === "string"),
      );
    }
    snapshot.current = map;
  }, []);

  React.useEffect(() => {
    if (!hasError) return;
    const form = formRef.current;
    if (!form) return;

    for (const element of Array.from(form.elements)) {
      const field = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (!field.name) continue;
      const values = snapshot.current.get(field.name);
      if (!values || values.length === 0) continue;

      if (field instanceof HTMLInputElement) {
        if (
          field.type === "password" ||
          field.type === "file" ||
          field.type === "hidden"
        ) {
          continue;
        }
        if (field.type === "checkbox" || field.type === "radio") {
          field.checked = values.includes(field.value);
          continue;
        }
        field.value = values[0] ?? field.value;
      } else {
        field.value = values[0] ?? field.value;
      }
    }
    // `state` identity changes on every action return; restore runs then.
  }, [state, hasError]);

  return { formRef, captureValues };
}

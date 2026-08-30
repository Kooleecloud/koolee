"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "../lib/utils";
import { Input } from "./input";

/**
 * A password input with a show/hide toggle.
 *
 * One component rather than a toggle bolted onto each form, because there are
 * three password fields across two apps and they have to behave identically —
 * the same control in the same place with the same label, or a staff member
 * moving between the agent PWA and the admin console has to relearn it.
 *
 * The details that make it worth a component:
 *
 *  - the button is `type="button"`. A bare `<button>` inside a form defaults
 *    to `type="submit"`, so revealing the password would submit the form;
 *  - it is NOT in the tab order (`tabIndex={-1}`). Tabbing out of a password
 *    field should reach the submit button, not a decoration in between. It is
 *    still reachable by anyone who wants it, and screen readers announce it
 *    from the label below;
 *  - `aria-pressed` plus a label that changes with the state, so the control
 *    announces what it will DO and what it currently IS;
 *  - visibility is component state and resets on every mount. A revealed
 *    password never survives a navigation.
 *
 * `autoComplete` is required rather than defaulted: `current-password` on a
 * sign-in form and `new-password` on a set-password form are what stop a
 * password manager filling the wrong one, and a default would silently pick
 * the wrong side for half the call sites.
 */
export interface PasswordFieldProps
  extends Omit<React.ComponentProps<"input">, "type"> {
  autoComplete: "current-password" | "new-password";
}

export const PasswordField = React.forwardRef<HTMLInputElement, PasswordFieldProps>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);

    return (
      <div className="relative">
        <Input
          {...props}
          ref={ref}
          type={visible ? "text" : "password"}
          // Room for the button, so a long password never runs under it.
          className={cn("pr-10", className)}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((current) => !current)}
          aria-pressed={visible}
          aria-label={visible ? "Hide password" : "Show password"}
          title={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="size-4" />
          ) : (
            <Eye aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
    );
  },
);
PasswordField.displayName = "PasswordField";

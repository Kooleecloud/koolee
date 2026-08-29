"use client";

import * as React from "react";
import { LogOut } from "lucide-react";
import {
  Badge,
  Button,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
} from "@koolee/ui";

import { signOutStaff } from "@/actions/auth";

import { useConsolePreferences } from "./preferences-context";
import { CONSOLE_HOME_OPTIONS, type ConsoleDensity } from "./preferences";

export interface ConsoleSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string | null;
  /**
   * `EnvStatus`, pre-rendered by the server layout. Null in production, where
   * the component renders nothing anyway — passing the element rather than
   * the data keeps env reading on the server.
   */
  diagnostics?: React.ReactNode;
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Console settings, as a right-hand sheet.
 *
 * A sheet rather than a `/settings` route because none of this is a
 * destination: an operator changes density while looking at the board they
 * want denser, and a route would take that board off the screen.
 *
 * Every control here is an existing `packages/ui` primitive — `Select`,
 * `CheckboxField`, `Button`, `Badge` — and the sheet itself is the shared
 * `Dialog` re-anchored to the right edge, which `tailwind-merge` resolves
 * cleanly against `DialogContent`'s centring classes. Nothing new is defined,
 * so the console keeps the same controls as web and agent.
 */
export function ConsoleSettings({
  open,
  onOpenChange,
  email,
  diagnostics,
}: ConsoleSettingsProps) {
  const { preferences, update } = useConsolePreferences();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="inset-y-0 top-0 right-0 left-auto flex h-dvh w-full max-w-100 translate-x-0 translate-y-0 flex-col gap-0 border-l bg-card p-0 duration-200 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:rounded-none"
        aria-describedby="console-settings-description"
      >
        <DialogHeader className="h-14 shrink-0 justify-center border-b border-border px-5 text-left">
          <DialogTitle className="font-display text-base font-semibold text-navy-800">
            Settings
          </DialogTitle>
          <DialogDescription id="console-settings-description" className="sr-only">
            Your account, and how this console displays data.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-5">
          <SettingsSection title="Account">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-navy-50 text-xs font-semibold text-navy-700"
              >
                {(email?.split("@")[0] ?? "??").slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {email ?? "Signed in"}
              </span>
              <Badge>admin</Badge>
            </div>
            <form action={signOutStaff}>
              <Button type="submit" variant="outline" className="w-full">
                <LogOut aria-hidden="true" />
                Sign out
              </Button>
            </form>
          </SettingsSection>

          <SettingsSection title="Display">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="console-density">Table density</Label>
              <Select
                id="console-density"
                value={preferences.density}
                onChange={(event) =>
                  update({ density: event.target.value as ConsoleDensity })
                }
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </Select>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Compact tightens board rows and list cards — roughly four more bookings
                above the fold.
              </p>
            </div>

            <CheckboxField
              label="Show my local time"
              hint="Adds your own zone beside the airport time on a booking. The airport time stays the authoritative one."
              checked={preferences.viewerTime}
              onChange={(event) => update({ viewerTime: event.target.checked })}
            />
          </SettingsSection>

          <SettingsSection title="Console">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="console-home">Home link</Label>
              <Select
                id="console-home"
                value={preferences.home}
                onChange={(event) => update({ home: event.target.value })}
              >
                {CONSOLE_HOME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Where the wordmark takes you. Dispatchers who live on the board rarely
                want Overview.
              </p>
            </div>
          </SettingsSection>

          {diagnostics ? (
            <SettingsSection title="Diagnostics">{diagnostics}</SettingsSection>
          ) : null}

          <p className="mt-auto border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
            Preferences are stored in this browser, not on your staff account — a laptop
            and a desk monitor want different layouts.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

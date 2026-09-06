"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { Button } from "./button";
import { cn } from "../lib/utils";

/**
 * A panel that slides in from the edge, for a form that is not the page.
 *
 * WHY IT EXISTS. Six console pages had grown the same layout: a list on the
 * left and a form pinned permanently down the right in a `2fr 1fr` grid —
 * invite staff, add a truck, assign ZIPs, block windows, add an airline,
 * publish a pricing rule. Every one of those forms is used occasionally and
 * read never, and each was taking a third of the page from the thing an
 * operator actually came to look at. The staff list, the truck list and the
 * zone table were all rendering in two thirds of the width they had, with a
 * blank form beside them, all day.
 *
 * So the form moves behind a NAMED button in the section header — "Invite",
 * "Add a truck" — and the list gets the whole page. A labelled button is also
 * a better answer to "what can I do here?" than a form somebody has to read to
 * find out.
 *
 * A SHEET RATHER THAN A DIALOG, and the difference matters for these. A modal
 * dialog in the middle of the screen is for a decision — confirm, cancel. These
 * are data entry with five or six fields, sometimes a list to scroll, and a
 * side panel gives them full page height without covering the table the
 * operator is checking their entry against. `ConfirmDialog` stays what it is
 * and is still the right thing for a destructive yes/no.
 *
 * Built on the same Radix Dialog primitive the modal uses, so focus trapping,
 * scroll locking, Escape and the return-focus-to-trigger behaviour are the
 * ones already in the app rather than a second implementation of them.
 */

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

export interface SheetContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  /** Which edge it comes from. `right` is the default and the console's habit. */
  side?: "right" | "left";
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ className, children, side = "right", ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-black/50",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
      )}
    />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-y-0 z-50 flex w-full flex-col gap-4 overflow-y-auto bg-card p-6 shadow-lift-lg",
        // Capped, not full-width: a form stretched across a desktop monitor
        // has fields a metre long, and the point of a sheet is that the page
        // behind it stays visible for reference.
        "sm:max-w-md",
        side === "right"
          ? "right-0 border-l border-border data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
          : "left-0 border-r border-border data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close asChild>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-4 top-4"
          aria-label="Close"
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";

function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // `pr-10` clears the close button, which is absolutely positioned over this
  // corner — without it a long title runs underneath it.
  return <div className={cn("flex flex-col gap-1.5 pr-10", className)} {...props} />;
}

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("font-display text-lg font-semibold text-navy-800", className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;

/**
 * The whole pattern in one component: a labelled button that opens a titled
 * sheet around whatever form you give it.
 *
 * Exists so six pages do not each wire up a trigger, a title, a description
 * and a close — which is how six sheets end up with six different paddings and
 * one of them missing its description.
 *
 * `Sheet` and its parts stay exported for anything that needs the pieces.
 */
export function FormSheet({
  trigger,
  title,
  description,
  children,
  side,
}: {
  /** The button. Rendered through the trigger, so it keeps its own styling. */
  trigger: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  side?: "right" | "left";
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side={side}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
};

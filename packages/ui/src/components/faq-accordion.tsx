"use client";

import * as React from "react";

import { cn } from "../lib/utils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./accordion";

export interface FAQItem {
  /** Stable id; also used as the accordion value. */
  id: string;
  question: string;
  answer: React.ReactNode;
}

export interface FAQAccordionProps extends React.HTMLAttributes<HTMLDivElement> {
  items: FAQItem[];
  /** Open this item initially (id). */
  defaultOpenId?: string;
}

/** FAQ list — one open at a time keeps answers focused. */
function FAQAccordion({ items, defaultOpenId, className, ...props }: FAQAccordionProps) {
  return (
    <div className={cn("w-full", className)} {...props}>
      <Accordion
        type="single"
        collapsible
        {...(defaultOpenId ? { defaultValue: defaultOpenId } : {})}
      >
        {items.map((item) => (
          <AccordionItem key={item.id} value={item.id}>
            <AccordionTrigger>{item.question}</AccordionTrigger>
            <AccordionContent>{item.answer}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

export { FAQAccordion };

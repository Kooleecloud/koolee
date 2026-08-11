import { redirect } from "next/navigation";

/**
 * Retired step: bags merged into /book/pickup (address + bags) when the
 * funnel merged from seven pages to four.
 */
export default function RetiredBagsStepPage() {
  redirect("/book/pickup");
}

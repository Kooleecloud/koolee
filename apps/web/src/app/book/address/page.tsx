import { redirect } from "next/navigation";

/**
 * Retired step: address merged into /book/pickup (address + bags) when the
 * funnel merged from seven pages to four.
 */
export default function RetiredAddressStepPage() {
  redirect("/book/pickup");
}

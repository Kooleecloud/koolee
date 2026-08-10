import { redirect } from "next/navigation";

/**
 * Retired step: the price quote became the review panel on /book/pay when
 * the funnel merged from seven pages to four.
 */
export default function RetiredPriceStepPage() {
  redirect("/book/pay");
}

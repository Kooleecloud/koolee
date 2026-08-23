import { redirect } from "next/navigation";

/**
 * Retired step: ZIP moved onto the flight step when the funnel merged from
 * seven pages to four. Old links and bookmarks resume via /book.
 */
export default function RetiredZipStepPage() {
  redirect("/book");
}

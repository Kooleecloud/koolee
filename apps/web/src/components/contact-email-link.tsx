import { SITE } from "@/lib/site";

/** The standard mailto link for the public contact address, styled per brand. */
export function ContactEmailLink() {
  return (
    <a
      href={`mailto:${SITE.contactEmail}`}
      className="text-sky-700 underline underline-offset-4 hover:text-sky-600"
    >
      {SITE.contactEmail}
    </a>
  );
}

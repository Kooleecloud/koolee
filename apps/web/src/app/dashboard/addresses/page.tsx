import { redirect } from "next/navigation";

/**
 * Retired route: saved addresses now live on `/dashboard/profile`, which
 * describes the same account. Kept as a redirect so existing links and
 * bookmarks still land somewhere useful.
 *
 * The address components and server actions stay in this folder — they are
 * imported by the profile page. Only the route is gone.
 */
export default function RetiredAddressesPage() {
  redirect("/dashboard/profile");
}

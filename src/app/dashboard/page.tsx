import { redirect } from "next/navigation";

/** The stablecoin route monitor moved to /routes inside the app shell. */
export default function DashboardRedirect() {
  redirect("/routes");
}

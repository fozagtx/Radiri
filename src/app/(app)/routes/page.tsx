import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/bits";
import { RadiriDashboard } from "@/components/radiri/radiri-dashboard";

export const metadata: Metadata = { title: "Route monitor | Radiri" };

export default function RoutesPage() {
  return (
    <>
      <PageHeader title="Route monitor" description="Stablecoin routes from NEAR Intents and Rhea, quoted at your size. Every quote is a dry run." />
      <RadiriDashboard />
    </>
  );
}

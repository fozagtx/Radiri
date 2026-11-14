import type { Metadata } from "next";
import { OverviewView } from "@/components/overview/overview-view";

export const metadata: Metadata = { title: "Overview | Radiri" };

export default function OverviewPage() {
  return <OverviewView />;
}

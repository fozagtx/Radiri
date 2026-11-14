import type { Metadata } from "next";
import { SwapWorkspace } from "@/components/swapping/swap-workspace";

export const metadata: Metadata = { title: "Swap | Radiri" };

export default function SwapPage() {
  return <SwapWorkspace />;
}

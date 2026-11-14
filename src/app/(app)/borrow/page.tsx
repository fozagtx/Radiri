import type { Metadata } from "next";
import { BorrowWorkspace } from "@/components/borrowing/borrow-workspace";

export const metadata: Metadata = { title: "Borrow | Radiri" };

export default function BorrowPage() {
  return <BorrowWorkspace />;
}

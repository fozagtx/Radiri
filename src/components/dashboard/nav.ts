import { Activity, ArrowLeftRight, ChartPie, HandCoins, Landmark, LayoutDashboard } from "lucide-react";

export interface AppNavItem {
  label: string;
  href: string;
  icon: typeof Activity;
}

export const PRIMARY_NAV: AppNavItem[] = [
  { label: "Overview", href: "/overview", icon: LayoutDashboard },
  { label: "Borrow", href: "/borrow", icon: HandCoins },
  { label: "Swap", href: "/swap", icon: ArrowLeftRight },
  { label: "Portfolio", href: "/portfolio", icon: ChartPie },
  { label: "Markets", href: "/markets", icon: Landmark },
  { label: "Activity", href: "/activity", icon: Activity },
];

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

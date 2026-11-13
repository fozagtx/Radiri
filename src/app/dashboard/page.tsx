import { RadiriDashboard } from "@/components/radiri/radiri-dashboard";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { NotchNavbar } from "@/components/ui/notch-navbar";

const MOBILE_LINKS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Connect MCP", href: "/mcp" },
];

export default function DashboardPage() {
  return (
    <div className="flex min-h-screen">
      <DashboardSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="md:hidden">
          <NotchNavbar links={MOBILE_LINKS} />
        </div>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-20 pb-6 md:pt-6">
          <div className="mb-3">
            <h1 className="font-display text-2xl leading-tight">Stablecoin routes</h1>
            <p className="text-xs text-muted-foreground">
              NEAR Intents and Rhea, quoted at your size. Every quote is a dry run.
            </p>
          </div>

          <RadiriDashboard />
        </main>

        <footer className="border-t">
          <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-1 px-4 py-3 text-[0.7rem] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Quotes from live sources, never cached screenshots.</span>
            <span>Snapshots are written by the monitor to radiri.testnet.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

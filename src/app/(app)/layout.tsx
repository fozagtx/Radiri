import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { MobileWalletBar } from "@/components/dashboard/mobile-bar";
import { MOBILE_LINKS } from "@/components/dashboard/nav";
import { LendingProvider } from "@/components/shared/lending-provider";
import { NotchNavbar } from "@/components/ui/notch-navbar";

/** App shell: sidebar on desktop, notch navbar + wallet strip on phones. Pages render only content. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <LendingProvider>
    <div className="flex min-h-screen">
      <DashboardSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="md:hidden">
          <NotchNavbar links={MOBILE_LINKS} />
          <div className="h-14" aria-hidden />
          <MobileWalletBar />
        </div>

        <main className="mx-auto w-full max-w-[1400px] min-w-0 flex-1 px-4 pt-4 pb-8 md:pt-6">{children}</main>

        <footer className="border-t">
          <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-1 px-4 py-3 text-[0.7rem] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Lending runs on NEAR testnet with test tokens that have no value.</span>
            <span>Swaps settle on mainnet through NEAR Intents 1Click.</span>
          </div>
        </footer>
      </div>
    </div>
    </LendingProvider>
  );
}

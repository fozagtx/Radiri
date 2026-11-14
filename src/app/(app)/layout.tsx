import { AppHeader } from "@/components/app/app-header";
import { LendingProvider } from "@/components/shared/lending-provider";

/** App shell: sticky top bar with navigation and wallets. Pages render only their content. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <LendingProvider>
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 pt-6 pb-12 md:pt-10">{children}</main>
        <footer className="border-t border-foreground/8">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-4 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Lending runs on NEAR testnet with test tokens that have no value.</span>
            <span>Swaps settle on mainnet through NEAR Intents.</span>
          </div>
        </footer>
      </div>
    </LendingProvider>
  );
}

import { AppHeader } from "@/components/app/app-header";
import { ChakraUIProvider } from "@/components/chakra/provider";
import { AppFooter } from "@/components/app/app-footer";
import { LendingProvider } from "@/components/shared/lending-provider";

/** App shell (Chakra UI): sticky header with navigation, wallets and live prices. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChakraUIProvider>
      <LendingProvider>
        <AppHeader />
        <main style={{ flex: 1, width: "100%" }}>{children}</main>
        <AppFooter />
      </LendingProvider>
    </ChakraUIProvider>
  );
}

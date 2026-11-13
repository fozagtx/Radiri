"use client";

import { LogOut, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/components/wallet-provider";

export function WalletStatus() {
  const { accountId, ready, signIn, signOut } = useWallet();

  if (!ready) {
    return <div className="h-7 w-40 animate-pulse rounded-lg bg-muted" aria-hidden />;
  }

  if (!accountId) {
    return (
      <Button size="sm" variant="outline" onClick={() => void signIn()}>
        <Wallet aria-hidden />
        Connect wallet
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Badge variant="outline" className="font-mono text-[0.7rem]">
        {accountId}
      </Badge>
      <Button size="icon-sm" variant="ghost" aria-label="Sign out" onClick={() => void signOut()}>
        <LogOut aria-hidden />
      </Button>
    </div>
  );
}

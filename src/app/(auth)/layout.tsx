import type { ReactNode } from "react";
import { DemoBanner, Logo } from "@/components/brand";
import { isDemoMode } from "@/lib/env";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      {isDemoMode() ? <DemoBanner /> : null}
      <div className="mx-auto flex max-w-md flex-col px-4 py-10">
        <Logo />
        <main id="main" className="mt-8">
          {children}
        </main>
      </div>
    </div>
  );
}

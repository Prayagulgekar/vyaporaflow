import Link from "next/link";
import type { ReactNode } from "react";
import { Logo, DemoBanner } from "@/components/brand";
import { isDemoMode } from "@/lib/env";
import { getSessionUser } from "@/server/auth/session";

const LINKS = [
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/for-wholesalers", label: "For wholesalers" },
  { href: "/for-retailers", label: "For retailers" },
  { href: "/pricing", label: "Pricing" },
];

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser().catch(() => null);
  return (
    <div className="flex min-h-screen flex-col">
      {isDemoMode() ? <DemoBanner /> : null}
      <header className="border-b border-line bg-canvas">
        <div className="mx-auto flex h-16 max-w-[var(--spacing-content)] items-center gap-6 px-4 sm:px-6">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-5 text-sm text-ink-muted lg:flex">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-ink">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {user ? (
              <Link href="/app" className="btn btn-primary btn-sm">
                Open workspace
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn btn-ghost btn-sm">
                  Sign in
                </Link>
                <Link href="/register" className="btn btn-primary btn-sm hidden sm:inline-flex">
                  Create account
                </Link>
              </>
            )}
            <details className="relative lg:hidden">
              <summary className="btn btn-secondary btn-sm list-none">Menu</summary>
              <nav aria-label="Main (mobile)" className="absolute right-0 top-11 z-30 flex w-60 flex-col rounded-lg border border-line bg-surface p-2 text-sm shadow-[var(--shadow-raised)]">
                {LINKS.map((l) => (
                  <Link key={l.href} href={l.href} className="rounded px-3 py-2 hover:bg-sunken">
                    {l.label}
                  </Link>
                ))}
                <Link href="/register" className="rounded px-3 py-2 font-medium text-accent hover:bg-sunken">
                  Create account
                </Link>
              </nav>
            </details>
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-line bg-sunken">
        <div className="mx-auto grid max-w-[var(--spacing-content)] gap-8 px-4 py-10 text-sm sm:grid-cols-3 sm:px-6">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-ink-muted">Order, stock, delivery and payment records for wholesale distributors and the retailers they supply.</p>
          </div>
          <nav aria-label="Product" className="flex flex-col gap-2 text-ink-muted">
            <Link href="/features" className="hover:text-ink">Features</Link>
            <Link href="/how-it-works" className="hover:text-ink">How it works</Link>
            <Link href="/marketplace" className="hover:text-ink">Marketplace</Link>
            <Link href="/pricing" className="hover:text-ink">Pricing</Link>
          </nav>
          <nav aria-label="Company" className="flex flex-col gap-2 text-ink-muted">
            <Link href="/contact" className="hover:text-ink">Contact</Link>
            <Link href="/terms" className="hover:text-ink">Terms of use</Link>
            <Link href="/privacy" className="hover:text-ink">Privacy policy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

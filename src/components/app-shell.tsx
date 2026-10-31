import Link from "next/link";
import type { ReactNode } from "react";
import { Bars3Icon, BellIcon } from "@heroicons/react/24/outline";
import { isDemoMode } from "@/lib/env";
import { initials } from "@/lib/format";
import { logoutAction, switchCompanyAction } from "@/features/auth/actions";
import { DemoBanner, Logo } from "./brand";
import { BottomTabs, SideNav, type NavItem } from "./nav";

export interface ShellProps {
  area: string;
  nav: NavItem[];
  mobileTabs?: NavItem[];
  user: { name: string; email: string };
  company?: { id: string; name: string; role: string; suspended?: boolean };
  companies?: { id: string; name: string }[];
  unread?: number;
  children: ReactNode;
}

export function AppShell({ area, nav, mobileTabs, user, company, companies, unread = 0, children }: ShellProps) {
  const demo = isDemoMode();
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      {demo ? <DemoBanner /> : null}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4">
          <details className="relative lg:hidden">
            <summary className="btn btn-ghost btn-sm list-none px-2" aria-label="Open menu">
              <Bars3Icon className="size-6" aria-hidden />
            </summary>
            <div className="absolute top-11 left-0 z-30 w-72 rounded-lg border border-line bg-surface p-3 shadow-[var(--shadow-raised)]">
              <SideNav items={nav} label={`${area} menu`} />
            </div>
          </details>
          <Logo href="/" />
          <span className="hidden text-sm text-ink-muted sm:inline">/ {area}</span>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/notifications" className="btn btn-ghost btn-sm relative px-2" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
              <BellIcon className="size-5" aria-hidden />
              {unread ? <span className="absolute -top-0.5 -right-0.5 rounded-full bg-accent px-1 text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span> : null}
            </Link>
            <details className="relative">
              <summary className="btn btn-ghost btn-sm list-none" aria-label="Account menu">
                <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong sm:hidden" aria-hidden>
                  {initials(user.name || user.email)}
                </span>
                <span className="hidden max-w-40 truncate sm:inline">{user.name || user.email}</span>
              </summary>
              <div className="absolute right-0 top-11 z-30 w-72 rounded-lg border border-line bg-surface p-3 text-sm shadow-[var(--shadow-raised)]">
                <p className="font-semibold">{user.name}</p>
                <p className="truncate text-ink-muted">{user.email}</p>
                {company ? (
                  <p className="mt-2 text-ink-muted">
                    {company.name} · <span className="capitalize">{company.role.replace("_", " ")}</span>
                  </p>
                ) : null}
                {companies && companies.length > 1 ? (
                  <form action={switchCompanyAction} className="mt-3 flex gap-2">
                    <label htmlFor="switch-company" className="sr-only">
                      Switch business
                    </label>
                    <select id="switch-company" name="company_id" defaultValue={company?.id} className="input">
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-secondary btn-sm">Switch</button>
                  </form>
                ) : null}
                <div className="mt-3 flex flex-col gap-1 border-t border-line pt-3">
                  <Link href="/account" className="rounded px-2 py-1 hover:bg-sunken">
                    My account
                  </Link>
                  <form action={logoutAction}>
                    <button className="w-full rounded px-2 py-1 text-left hover:bg-sunken">Sign out</button>
                  </form>
                </div>
              </div>
            </details>
          </div>
        </div>
      </header>
      <div className="flex">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-line bg-surface p-3 lg:block">
          {company ? <p className="mb-3 truncate px-3 text-xs font-semibold tracking-wide text-ink-faint uppercase">{company.name}</p> : null}
          <SideNav items={nav} label={`${area} navigation`} />
        </aside>
        <main id="main" className={`min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 ${mobileTabs ? "pb-24 lg:pb-8" : ""}`}>
          {company?.suspended ? (
            <div role="alert" className="mb-4 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
              This business is suspended on VyaporaFlow. You can view records, but changes are blocked. Contact support.
            </div>
          ) : null}
          <div className="mx-auto max-w-[var(--spacing-content)]">{children}</div>
        </main>
      </div>
      {mobileTabs ? <BottomTabs items={mobileTabs} /> : null}
    </div>
  );
}

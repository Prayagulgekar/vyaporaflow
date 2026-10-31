import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav";
import { requireAdmin } from "@/server/viewer";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const viewer = await requireAdmin();
  const nav: NavItem[] = [
    { href: "/admin", label: "Overview", icon: "home", exact: true },
    { href: "/admin/companies", label: "Businesses", icon: "companies" },
    { href: "/admin/users", label: "Users", icon: "users" },
    { href: "/admin/support", label: "Support", icon: "support" },
    { href: "/admin/settings", label: "Platform settings", icon: "settings" },
    { href: "/admin/audit", label: "Audit log", icon: "audit" },
    { href: "/admin/health", label: "System health", icon: "health" },
  ];
  return (
    <AppShell area="Platform admin" nav={nav} user={{ name: viewer.fullName, email: viewer.email }}>
      {children}
    </AppShell>
  );
}

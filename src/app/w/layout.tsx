import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav";
import { unreadCount } from "@/server/notifications";
import { requireWholesaler } from "@/server/viewer";

export default async function WholesalerLayout({ children }: { children: ReactNode }) {
  const { viewer, company } = await requireWholesaler();
  const unread = await unreadCount(viewer.userId);
  const manager = company.role === "owner" || company.role === "manager";
  const nav: NavItem[] = [
    { href: "/w", label: "Overview", icon: "home", exact: true },
    { href: "/w/orders", label: "Orders", icon: "orders" },
    { href: "/w/products", label: "Products", icon: "products" },
    { href: "/w/inventory", label: "Inventory", icon: "inventory" },
    { href: "/w/retailers", label: "Retailers", icon: "retailers" },
    { href: "/w/billing", label: "Invoices", icon: "billing" },
    { href: "/w/payments", label: "Payments", icon: "payments" },
    { href: "/w/balances", label: "Balances", icon: "balances" },
    { href: "/w/delivery", label: "Delivery", icon: "delivery" },
    { href: "/w/cash-collections", label: "Cash Collections", icon: "wallet" },
    { href: "/w/purchasing", label: "Purchasing", icon: "purchasing" },
    { href: "/w/reports", label: "Reports", icon: "reports" },
    { href: "/w/profile", label: "Business profile", icon: "profile" },
    ...(manager ? [{ href: "/w/settings", label: "Team and settings", icon: "settings" } as NavItem] : []),
  ];
  return (
    <AppShell
      area="Wholesaler"
      nav={nav}
      user={{ name: viewer.fullName, email: viewer.email }}
      company={{ id: company.companyId, name: company.companyName, role: company.role, suspended: company.companyStatus === "suspended" }}
      companies={viewer.memberships.map((m) => ({ id: m.companyId, name: `${m.companyName} (${m.companyKind})` }))}
      unread={unread}
    >
      {children}
    </AppShell>
  );
}

import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav";
import { cartCount } from "@/server/cart";
import { unreadCount } from "@/server/notifications";
import { requireRetailer } from "@/server/viewer";

export default async function RetailerLayout({ children }: { children: ReactNode }) {
  const { viewer, company } = await requireRetailer();
  const [unread, inCart] = await Promise.all([unreadCount(viewer.userId), cartCount(viewer.userId, company.companyId)]);
  const nav: NavItem[] = [
    { href: "/r", label: "Home", icon: "home", exact: true },
    { href: "/r/discover", label: "Find wholesalers", icon: "discover" },
    { href: "/r/wholesalers", label: "My wholesalers", icon: "wholesalers" },
    { href: "/r/products", label: "Search products", icon: "search" },
    { href: "/r/cart", label: "Cart", icon: "cart", badge: inCart },
    { href: "/r/orders", label: "Orders", icon: "orders" },
    { href: "/r/invoices", label: "Invoices", icon: "billing" },
    { href: "/r/payments", label: "Payments and balances", icon: "wallet" },
    { href: "/r/profile", label: "Shop profile", icon: "profile" },
  ];
  const tabs: NavItem[] = [
    { href: "/r", label: "Home", icon: "home", exact: true },
    { href: "/r/wholesalers", label: "Wholesalers", icon: "wholesalers" },
    { href: "/r/cart", label: "Cart", icon: "cart", badge: inCart },
    { href: "/r/orders", label: "Orders", icon: "orders" },
    { href: "/r/payments", label: "Balance", icon: "wallet" },
  ];
  return (
    <AppShell
      area="Retailer"
      nav={nav}
      mobileTabs={tabs}
      user={{ name: viewer.fullName, email: viewer.email }}
      company={{ id: company.companyId, name: company.companyName, role: company.role, suspended: company.companyStatus === "suspended" }}
      companies={viewer.memberships.map((m) => ({ id: m.companyId, name: `${m.companyName} (${m.companyKind})` }))}
      unread={unread}
    >
      {children}
    </AppShell>
  );
}

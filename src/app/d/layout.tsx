import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav";
import { unreadCount } from "@/server/notifications";
import { requireDeliveryWorker } from "@/server/viewer";

export default async function DeliveryLayout({ children }: { children: ReactNode }) {
  const viewer = await requireDeliveryWorker();
  const unread = await unreadCount(viewer.userId);
  const nav: NavItem[] = [
    { href: "/d", label: "My deliveries", icon: "delivery", exact: true },
    { href: "/d?scope=completed", label: "Completed", icon: "orders", exact: true },
    { href: "/d/cash", label: "My cash", icon: "wallet", exact: true },
  ];
  const company = viewer.memberships.find((m) => m.companyKind === "wholesaler");
  return (
    <AppShell
      area="Delivery"
      nav={nav}
      mobileTabs={nav}
      user={{ name: viewer.fullName, email: viewer.email }}
      company={company ? { id: company.companyId, name: company.companyName, role: company.role } : undefined}
      unread={unread}
    >
      {children}
    </AppShell>
  );
}

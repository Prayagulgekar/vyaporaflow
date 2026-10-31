"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArchiveBoxIcon,
  BanknotesIcon,
  BellIcon,
  BuildingStorefrontIcon,
  ChartBarIcon,
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  CubeIcon,
  DocumentTextIcon,
  HomeIcon,
  IdentificationIcon,
  LifebuoyIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  ScaleIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  TruckIcon,
  UserGroupIcon,
  UsersIcon,
  WalletIcon,
  BuildingOffice2Icon,
  ServerStackIcon,
  ListBulletIcon,
} from "@heroicons/react/24/outline";

const ICONS = {
  home: HomeIcon,
  orders: ClipboardDocumentListIcon,
  products: CubeIcon,
  inventory: ArchiveBoxIcon,
  retailers: UserGroupIcon,
  billing: DocumentTextIcon,
  payments: BanknotesIcon,
  balances: ScaleIcon,
  delivery: TruckIcon,
  reports: ChartBarIcon,
  profile: IdentificationIcon,
  settings: Cog6ToothIcon,
  discover: MapPinIcon,
  wholesalers: BuildingStorefrontIcon,
  search: MagnifyingGlassIcon,
  cart: ShoppingCartIcon,
  wallet: WalletIcon,
  bell: BellIcon,
  users: UsersIcon,
  shield: ShieldCheckIcon,
  support: LifebuoyIcon,
  companies: BuildingOffice2Icon,
  health: ServerStackIcon,
  audit: ListBulletIcon,
  purchasing: ArchiveBoxIcon,
} as const;

export type IconName = keyof typeof ICONS;
export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
  exact?: boolean;
}

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
}

export function SideNav({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${active ? "bg-accent-soft font-semibold text-accent-strong" : "text-ink-muted hover:bg-sunken hover:text-ink"}`}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                <span className="flex-1">{item.label}</span>
                {item.badge ? (
                  <span className="rounded-full bg-accent px-1.5 text-xs font-semibold text-white" aria-label={`${item.badge} pending`}>
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Bottom tab bar for the mobile-first retailer and delivery experiences. */
export function BottomTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={active ? "page" : undefined} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${active ? "font-semibold text-accent" : "text-ink-muted"}`}>
                <Icon className="size-6" aria-hidden />
                {item.label}
                {item.badge ? <span className="absolute top-1 right-[calc(50%-1.25rem)] rounded-full bg-accent px-1 text-[10px] font-semibold text-white">{item.badge}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

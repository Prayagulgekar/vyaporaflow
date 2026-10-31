import Link from "next/link";
import { DemoBanner, Logo } from "@/components/brand";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { markNotificationsReadAction } from "@/features/shared/actions";
import { isDemoMode } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { listNotifications } from "@/server/notifications";
import { homePathFor, requireViewer } from "@/server/viewer";

export default async function Notifications() {
  const viewer = await requireViewer("/notifications");
  const items = await listNotifications(viewer.userId, 50);
  return (
    <div className="min-h-screen">
      {isDemoMode() ? <DemoBanner /> : null}
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between"><Logo href="/" /><Link href={homePathFor(viewer)} className="link text-sm">Back to my workspace</Link></div>
        <main id="main">
          <PageHeader title="Notifications" description="In-app notices only. VyaporaFlow does not send SMS, WhatsApp or email notifications." actions={items.some((i) => !i.read_at) ? <form action={markNotificationsReadAction}><button className="btn btn-secondary btn-sm">Mark all as read</button></form> : null} />
          {items.length === 0 ? <EmptyState title="No notifications" /> : (
            <Card padded={false}>
              <ul className="divide-y divide-line">
                {items.map((n) => (
                  <li key={n.id} className={`p-4 ${n.read_at ? "" : "bg-accent-soft/40"}`}>
                    <p className="font-medium">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}{n.read_at ? null : <span className="sr-only"> (unread)</span>}</p>
                    {n.body ? <p className="text-sm text-ink-muted">{n.body}</p> : null}
                    <p className="text-xs text-ink-faint">{formatDateTime(n.created_at)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}

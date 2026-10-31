import Link from "next/link";
import { RelationshipBadge } from "@/components/status";
import { ButtonLink, Card, EmptyState, Money, PageHeader } from "@/components/ui";
import { formatDate, whatsappLink } from "@/lib/format";
import { listMyWholesalers } from "@/server/relationships";
import { requireRetailer } from "@/server/viewer";

export default async function MyWholesalers() {
  const { viewer, company } = await requireRetailer();
  const rows = await listMyWholesalers(viewer.userId, company.companyId);
  return (
    <>
      <PageHeader title="My wholesalers" actions={<ButtonLink href="/r/discover">Find wholesalers</ButtonLink>} />
      {rows.length === 0 ? <EmptyState title="Not connected to any wholesaler yet" action={<ButtonLink href="/r/discover">Find wholesalers</ButtonLink>} /> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((w) => {
            const wa = whatsappLink(w.whatsapp_number ?? w.phone, `Hello ${w.name}, this is ${company.companyName}. `);
            return (
              <li key={w.relationship_id}>
                <Card>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-semibold">{w.status === "approved" ? <Link href={`/r/wholesalers/${w.wholesaler_id}`} className="hover:underline">{w.name}</Link> : w.name}</h2>
                      <p className="text-sm text-ink-muted">{w.city} · {w.product_count} products{w.last_order_at ? ` · last order ${formatDate(w.last_order_at)}` : ""}</p>
                    </div>
                    <RelationshipBadge status={w.status} />
                  </div>
                  <p className="mt-2 text-sm">You owe <strong><Money value={w.outstanding} /></strong></p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {w.status === "approved" ? <ButtonLink href={`/r/wholesalers/${w.wholesaler_id}`} size="sm">Order</ButtonLink> : null}
                    <ButtonLink href={`/marketplace/${w.slug}`} size="sm" variant="secondary">Profile</ButtonLink>
                    {wa && w.status === "approved" ? <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">WhatsApp</a> : null}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

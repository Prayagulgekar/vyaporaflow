import Link from "next/link";
import { notFound } from "next/navigation";
import { CoverageBadge, VerificationBadge } from "@/components/status";
import { Badge, Card, Money, Notice } from "@/components/ui";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/client";
import { requestConnectionAction } from "@/features/retailer/actions";
import { params, type SearchParams } from "@/features/shared/util";
import { formatQuantity, whatsappLink } from "@/lib/format";
import { coverageFor, getPublicWholesaler, resolveLocation, shopLocation } from "@/server/marketplace";
import { relationshipFor } from "@/server/relationships";
import { imageUrl } from "@/server/storage";
import { getViewer } from "@/server/viewer";

const DAY_LABEL: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

export default async function WholesalerPublic({ params: p, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const { slug } = await p;
  const sp = await params(searchParams);
  const viewer = await getViewer().catch(() => null);
  const w = await getPublicWholesaler(viewer?.userId ?? null, slug);
  if (!w) notFound();
  const retailer = viewer?.memberships.find((m) => m.companyKind === "retailer" && m.role !== "delivery_worker");
  const [rel, loc] = await Promise.all([
    retailer ? relationshipFor(viewer!.userId, retailer.companyId, w.id) : null,
    retailer ? shopLocation(viewer!.userId, retailer.companyId) : resolveLocation({ pincode: sp.pincode, city: sp.city, lat: sp.lat, lng: sp.lng }).then((r) => r.location),
  ]);
  const coverage = await coverageFor(viewer?.userId ?? null, w.id, loc);
  const logo = imageUrl(w.logo_path);
  const wa = whatsappLink(w.profile.whatsapp_number, `Hello ${w.name}, I found you on VyaporaFlow.`);
  return (
    <div className="mx-auto max-w-[var(--spacing-content)] px-4 py-10 sm:px-6">
      <p className="text-sm"><Link href="/marketplace" className="link">Marketplace</Link></p>
      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="size-16 rounded-lg border border-line object-cover" />
          ) : null}
          <div>
            <h1 className="font-display text-4xl">{w.name}</h1>
            <p className="text-ink-muted">{w.profile.business_category} · {w.address.city} {w.address.pincode}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <VerificationBadge status={w.verification_status} />
              {coverage ? <CoverageBadge coverage={coverage} /> : null}
              {w.is_open === true ? <Badge tone="ok">Open now</Badge> : w.is_open === false ? <Badge>Closed now</Badge> : null}
            </div>
          </div>
        </div>
        <div className="w-full max-w-sm">
          {!viewer ? (
            <Card>
              <p className="text-sm">Run a shop? Create a retailer account to ask {w.name} for access to prices and ordering.</p>
              <div className="mt-3 flex gap-2">
                <Link href={`/register?type=retailer`} className="btn btn-primary btn-sm">Create retailer account</Link>
                <Link href={`/login?next=/marketplace/${w.slug}`} className="btn btn-secondary btn-sm">Sign in</Link>
              </div>
            </Card>
          ) : retailer ? (
            rel?.status === "approved" ? (
              <Link href={`/r/wholesalers/${w.id}`} className="btn btn-primary w-full">Order from {w.name}</Link>
            ) : rel?.status === "pending" ? (
              <Notice tone="info">Your request to connect is waiting for approval.</Notice>
            ) : rel ? (
              <Notice tone="warn">This wholesaler is not accepting orders from your shop.</Notice>
            ) : (
              <Card title="Connect to order">
                <ActionForm action={requestConnectionAction} className="space-y-3">
                  <input type="hidden" name="wholesaler_id" value={w.id} />
                  <TextField name="note" label="Message (optional)" placeholder="Introduce your shop" />
                  <SubmitButton>Ask to connect</SubmitButton>
                </ActionForm>
              </Card>
            )
          ) : null}
        </div>
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          {w.profile.description ? <p className="mb-6 max-w-2xl">{w.profile.description}</p> : null}
          <h2 className="mb-3 text-lg font-semibold">Products ({w.products.length})</h2>
          {!w.can_view_prices ? <p className="mb-3 text-sm text-ink-muted">Prices are visible to approved retailers.</p> : null}
          <ul className="grid gap-3 sm:grid-cols-2">
            {w.products.map((pr) => (
              <li key={pr.id} className="card p-3">
                <p className="font-medium">{pr.name}</p>
                <p className="text-xs text-ink-muted">{[pr.brand, pr.category].filter(Boolean).join(" · ")}</p>
                <ul className="mt-2 space-y-0.5 text-sm">
                  {(pr.variants ?? []).map((v) => (
                    <li key={v.id}>
                      {v.name}
                      {(v.units ?? []).map((u) => (
                        <span key={u.id} className="ml-2 text-ink-muted">
                          {u.unit_code}{u.factor_to_base !== 1 ? ` of ${formatQuantity(String(u.factor_to_base), u.base_unit)}` : ""}
                          {w.can_view_prices && u.price !== null ? <>: <Money value={String(u.price)} /></> : null}
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-4">
          <Card title="Ordering">
            <ul className="space-y-1 text-sm">
              <li>Minimum order: {Number(w.profile.min_order_value) > 0 ? <Money value={w.profile.min_order_value} /> : "none"}</li>
              <li>{w.profile.offers_delivery ? <>Delivery charge: {Number(w.profile.delivery_charge) > 0 ? <Money value={w.profile.delivery_charge} /> : "free"}{w.profile.free_delivery_above ? <> (free above <Money value={w.profile.free_delivery_above} />)</> : null}</> : "Pickup only"}</li>
              <li>Payment terms: {w.profile.payment_terms_days ? `${w.profile.payment_terms_days} days` : "on delivery"}</li>
              <li>GST registered: {w.gstin_registered ? "yes" : "no"}</li>
            </ul>
            {wa && retailer && rel?.status === "approved" ? <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm mt-3">WhatsApp</a> : null}
          </Card>
          <Card title="Delivery areas">
            {w.zones.length === 0 ? <p className="text-sm text-ink-muted">{w.profile.offers_delivery ? "Delivery is confirmed per order." : "Pickup from the godown."}</p> : (
              <ul className="space-y-1 text-sm">{w.zones.map((z) => <li key={z.name}>{z.name}: {z.kind === "radius" ? `within ${z.radius_km} km` : `${z.pincodes.length} PIN codes`}</li>)}</ul>
            )}
          </Card>
          {w.profile.opening_hours ? (
            <Card title="Hours (India time)">
              <ul className="space-y-0.5 text-sm">
                {Object.entries(DAY_LABEL).map(([k, label]) => <li key={k} className="flex justify-between"><span>{label}</span><span>{w.profile.opening_hours?.[k] ? w.profile.opening_hours[k]!.join("–") : "Closed"}</span></li>)}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { importProductsAction } from "@/features/wholesaler/actions";
import { PRODUCT_CSV_HEADERS, listCategories } from "@/server/catalog";
import { requireWholesaler } from "@/server/viewer";

export default async function ImportExport() {
  const { company } = await requireWholesaler();
  const categories = await listCategories(company.companyId);
  return (
    <>
      <PageHeader eyebrow={<Link href="/w/products" className="link">Products</Link>} title="Import and export products" description="Use a CSV file. It opens in Excel, LibreOffice Calc and Google Sheets." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Export">
          <p className="text-sm text-ink-muted">Download all active products, one row per selling unit, in the same format the import accepts.</p>
          <ButtonLink href="/w/export/products" variant="secondary" className="mt-3" prefetch={false}>Download products CSV</ButtonLink>
        </Card>
        <Card title="Import">
          <ActionForm action={importProductsAction} className="space-y-3">
            <div>
              <label htmlFor="file" className="label">CSV file</label>
              <input id="file" name="file" type="file" accept=".csv,text/csv" required className="block text-sm" />
              <p className="hint">Up to 1000 rows and 2 MB. Rows with the same SKU become one variant with several selling units. SKUs that already exist are skipped. If any row is invalid, nothing is imported.</p>
            </div>
            <SubmitButton pendingLabel="Importing…">Import</SubmitButton>
          </ActionForm>
        </Card>
      </div>
      <Card title="Columns" className="mt-6">
        <p className="font-mono text-xs break-words">{PRODUCT_CSV_HEADERS.join(",")}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-muted">
          <li><code>gst_rate</code> is a number such as 5 or 18. <code>price_includes_tax</code> is true or false.</li>
          <li><code>stock_unit</code> and <code>sale_unit</code> are unit codes such as piece, packet, box, carton, kg, litre, cylinder.</li>
          <li><code>units_per_sale_unit</code> is how many stock units are in one sale unit (for example 24 packets in a box).</li>
          <li><code>opening_stock</code> is counted in the stock unit and is used for new SKUs only.</li>
        </ul>
        <p className="mt-3 text-sm">Category codes: {categories.map((c) => <code key={c.id} className="mr-2">{c.slug}</code>)}</p>
      </Card>
    </>
  );
}

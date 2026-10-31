import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { createProductAction } from "@/features/wholesaler/actions";
import { ProductForm } from "@/features/wholesaler/product-form";
import { listBrands, listCategories, listTaxClasses, listUnits } from "@/server/catalog";
import { requireWholesaler } from "@/server/viewer";

export default async function NewProduct() {
  const { company } = await requireWholesaler();
  const [categories, brands, taxClasses, units] = await Promise.all([listCategories(company.companyId), listBrands(company.companyId), listTaxClasses(company.companyId), listUnits()]);
  return (
    <>
      <PageHeader eyebrow={<Link href="/w/products" className="link">Products</Link>} title="Add a product" description="Add more variants (sizes, flavours) after saving." />
      <div className="max-w-3xl">
        <ProductForm action={createProductAction} categories={categories} brands={brands} taxClasses={taxClasses} units={units} withVariant submitLabel="Save product" />
      </div>
    </>
  );
}

import { Card, PageHeader } from "@/components/ui";
import { AddressForm, CompanyDetailsForm } from "@/features/shared/company-forms";
import { updateShopAction, updateShopAddressAction } from "@/features/retailer/actions";
import { getCompanyProfile, listStates } from "@/server/companies";
import { imageUrl } from "@/server/storage";
import { requireRetailer } from "@/server/viewer";

export default async function ShopProfile() {
  const { viewer, company } = await requireRetailer();
  const [c, states] = await Promise.all([getCompanyProfile(viewer.userId, company.companyId), listStates()]);
  return (
    <>
      <PageHeader title="Shop profile" description="Wholesalers see these details on your orders and invoices." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Shop details"><CompanyDetailsForm action={updateShopAction} c={c} logoUrl={imageUrl(c.logo_path)} /></Card>
        <Card title="Shop address">
          <AddressForm action={updateShopAddressAction} a={c.address} states={states} />
          <p className="mt-3 text-xs text-ink-muted">Changing the address affects new orders only. Existing orders keep the address they were placed with.</p>
        </Card>
      </div>
    </>
  );
}

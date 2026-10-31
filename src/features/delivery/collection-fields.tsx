"use client";

import { useState } from "react";
import { Money } from "@/components/ui";
import { SelectField, TextField } from "@/components/ui/client";
import { checkCollection } from "@/domain/cash";

/**
 * Amount collected from the shop, with a live "still due" preview. The preview
 * is only a guide: the server checks the amount against the order again.
 */
export function CollectionFields({ orderValue, paid, balanceDue, maxTime, idPrefix = "c" }: { orderValue: string; paid: string; balanceDue: string; maxTime: string; idPrefix?: string }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const check = amount.trim() === "" ? null : checkCollection(balanceDue, amount);
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-sunken p-3 text-sm">
        <dt className="text-ink-muted">Order total</dt>
        <dd className="text-right font-medium"><Money value={orderValue} /></dd>
        <dt className="text-ink-muted">Already paid</dt>
        <dd className="text-right"><Money value={paid} /></dd>
        <dt className="text-ink-muted">Due now</dt>
        <dd className="text-right font-semibold"><Money value={Number(balanceDue) > 0 ? balanceDue : "0"} /></dd>
      </dl>
      <TextField
        id={`${idPrefix}-amount`}
        name="amount"
        label="Amount collected now (₹)"
        inputMode="decimal"
        autoComplete="off"
        required
        placeholder="0 if nothing was collected"
        value={amount}
        onChange={(e) => setAmount(e.currentTarget.value)}
        className="text-lg"
      />
      <div aria-live="polite" className="text-sm">
        {check === null ? <p className="text-ink-muted">Enter exactly what the shop paid you. Enter 0 if they paid nothing.</p> : check.ok ? (
          <p>Shop will still owe <strong><Money value={check.remaining} /></strong> after this.</p>
        ) : (
          <p className="text-danger">{check.error}</p>
        )}
      </div>
      <SelectField id={`${idPrefix}-method`} name="method" label="Paid by" value={method} onChange={(e) => setMethod(e.currentTarget.value)}>
        <option value="cash">Cash (you hand it to the office)</option>
        <option value="upi">UPI to the business account</option>
      </SelectField>
      {method === "upi" ? <TextField id={`${idPrefix}-reference`} name="reference" label="UPI reference" required placeholder="12-digit UTR from the shop's phone" /> : null}
      <details className="text-sm">
        <summary className="cursor-pointer text-ink-muted">Different time or a note</summary>
        <div className="mt-2 space-y-3">
          <TextField id={`${idPrefix}-at`} name="collected_at" label="Collected at" type="datetime-local" max={maxTime} hint="Leave empty if you collected it just now." />
          <TextField id={`${idPrefix}-note`} name="collection_note" label="Payment note" placeholder="e.g. Shop will pay the rest on Friday" />
        </div>
      </details>
    </div>
  );
}

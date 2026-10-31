"use client";

import { startTransition, useActionState } from "react";
import type { ActionState } from "@/lib/action-state";

type Action = (s: ActionState, fd: FormData) => Promise<ActionState>;

function Btn({ inCart, pending }: { inCart: boolean; pending: boolean }) {
  return (
    <button type="submit" className={`btn btn-sm ${inCart ? "btn-secondary" : "btn-primary"}`} disabled={pending}>
      {pending ? "…" : inCart ? "Update" : "Add"}
    </button>
  );
}

/** Quantity box for one selling unit. Quantity 0 removes the line. */
const trim = (v: string) => (v.includes(".") ? v.replace(/\.?0+$/, "") : v);

export function AddToCart({ action, variantUnitId, unit, min, step, inCart, label, disabled }: { action: Action; variantUnitId: string; unit: string; min: string; step: string; inCart: string | null; label: string; disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(action, { ok: false } as ActionState);
  return (
    <form
      action={formAction}
      // Submit through the action state so a rejected quantity stays in the box for correction.
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="variant_unit_id" value={variantUnitId} />
      <label className="sr-only" htmlFor={`q-${variantUnitId}`}>
        Quantity of {label} in {unit}
      </label>
      <input id={`q-${variantUnitId}`} name="quantity" type="number" inputMode="decimal" min={0} step={step === "any" ? "any" : trim(step)} defaultValue={trim(inCart ?? min)} className="input w-20 py-1.5 text-right" disabled={disabled} />
      <span className="text-sm text-ink-muted">{unit}</span>
      {disabled ? null : <Btn inCart={!!inCart} pending={pending} />}
      {state.message ? (
        <span role="status" className={`w-full text-xs ${state.ok ? "text-ok" : "text-danger"}`}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

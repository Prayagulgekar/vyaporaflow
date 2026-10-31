"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action-state";
import { cx, Field, Input, Notice, Select, Textarea } from "./index";

export function SubmitButton({ children, variant = "primary", size, pendingLabel, className, name, value, disabled }: { children: ReactNode; variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm"; pendingLabel?: string; className?: string; name?: string; value?: string; disabled?: boolean }) {
  const pending = useFormPending();
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} aria-busy={pending} className={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", className)}>
      {pending ? (pendingLabel ?? "Saving…") : children}
    </button>
  );
}

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Form bound to a server action. Shows the action's success or error message
 * and passes field errors to children. Works without JavaScript as a plain form post.
 */
const FormState = createContext<ActionState>({ ok: false });
const FormPending = createContext(false);

export function useFormState(): ActionState {
  return useContext(FormState);
}

/** True while the enclosing form is submitting (ActionForm or a plain action form). */
export function useFormPending(): boolean {
  const actionForm = useContext(FormPending);
  const { pending } = useFormStatus();
  return actionForm || pending;
}

export function ActionForm({ action, children, className, resetOnSuccess, id, successSlot, hideMessage }: { action: Action; children: ReactNode | ((state: ActionState) => ReactNode); className?: string; resetOnSuccess?: boolean; id?: string; successSlot?: (state: ActionState) => ReactNode; hideMessage?: boolean }) {
  const [state, formAction, pending] = useActionState(action, { ok: false } as ActionState);
  const ref = useRef<HTMLFormElement>(null);
  // After a successful save the form returns to its (freshly rendered) defaults,
  // as before; after a failure it keeps what the user typed.
  const keepAfterSuccess = resetOnSuccess === false;
  useEffect(() => {
    if (state.ok && !keepAfterSuccess) ref.current?.reset();
  }, [state, keepAfterSuccess]);
  // React resets a form after its `action` runs, which would wipe what the user
  // typed whenever the server rejects it. Submitting through the action state
  // directly keeps every value so the user can correct the highlighted field.
  // (Without JavaScript the form still posts through `action`.)
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const fd = new FormData(e.currentTarget, submitter instanceof HTMLElement ? submitter : null);
    startTransition(() => formAction(fd));
  }
  useEffect(() => {
    if (!state.ok && state.fieldErrors) {
      const first = Object.keys(state.fieldErrors)[0];
      const el = first ? ref.current?.querySelector<HTMLElement>(`[name="${CSS.escape(first)}"]`) : null;
      el?.focus();
    }
  }, [state]);
  return (
    <FormState.Provider value={state}>
    <FormPending.Provider value={pending}>
    <form ref={ref} action={formAction} onSubmit={onSubmit} className={className} id={id} noValidate>
      {state.message && !hideMessage ? (
        <div className="mb-3">
          <Notice tone={state.ok ? "ok" : "danger"}>{state.message}</Notice>
        </div>
      ) : null}
      {state.ok && successSlot ? successSlot(state) : null}
      {typeof children === "function" ? children(state) : children}
    </form>
    </FormPending.Provider>
    </FormState.Provider>
  );
}

/** Button that asks for confirmation in an accessible dialog before submitting its form. */
export function ConfirmSubmit({ label, title, body, confirmLabel = "Confirm", variant = "danger", size, children }: { label: string; title: string; body: ReactNode; confirmLabel?: string; variant?: "danger" | "primary" | "secondary"; size?: "sm"; children?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const pending = useFormPending();
  return (
    <>
      <button type="button" className={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm")} onClick={() => ref.current?.showModal()} disabled={pending}>
        {pending ? "Working…" : label}
      </button>
      <dialog ref={ref} className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink shadow-[var(--shadow-raised)] backdrop:bg-black/30" aria-labelledby="confirm-title">
        <div className="p-5">
          <h2 id="confirm-title" className="text-lg font-semibold">
            {title}
          </h2>
          <div className="mt-2 text-sm text-ink-muted">{body}</div>
          {children ? <div className="mt-3">{children}</div> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => ref.current?.close()}>
              Cancel
            </button>
            <button type="submit" className={cx("btn", `btn-${variant}`)} onClick={() => setTimeout(() => ref.current?.close(), 0)}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <label className="label" htmlFor="copy-field">
        {label}
      </label>
      <div className="flex gap-2">
        <input id="copy-field" readOnly value={value} className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={async () => {
            await navigator.clipboard?.writeText(value).catch(() => undefined);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

type FieldBase = { name: string; label: string; hint?: ReactNode; required?: boolean };

/** Labelled input that shows the enclosing ActionForm's field error for `name`. */
export function TextField({ name, label, hint, required, ...props }: FieldBase & Omit<ComponentProps<"input">, "name">) {
  const err = useFormState().fieldErrors?.[name];
  return (
    <Field label={label} name={props.id ?? name} error={err} hint={hint} required={required}>
      <Input name={name} error={err} required={required} {...props} />
    </Field>
  );
}

export function SelectField({ name, label, hint, required, children, ...props }: FieldBase & Omit<ComponentProps<"select">, "name">) {
  const err = useFormState().fieldErrors?.[name];
  return (
    <Field label={label} name={props.id ?? name} error={err} hint={hint} required={required}>
      <Select name={name} error={err} required={required} {...props}>
        {children}
      </Select>
    </Field>
  );
}

export function TextareaField({ name, label, hint, required, ...props }: FieldBase & Omit<ComponentProps<"textarea">, "name">) {
  const err = useFormState().fieldErrors?.[name];
  return (
    <Field label={label} name={props.id ?? name} error={err} hint={hint} required={required}>
      <Textarea name={name} error={err} required={required} {...props} />
    </Field>
  );
}

/** Field errors for a key that has no single input (e.g. a group of checkboxes). */
export function FieldErrorText({ name }: { name: string }) {
  const err = useFormState().fieldErrors?.[name];
  return err?.length ? <p className="field-error">{err.join(". ")}</p> : null;
}

/** Renders children only after the enclosing ActionForm succeeded. */
export function WhenOk({ children }: { children: ReactNode }) {
  return useFormState().ok ? <>{children}</> : null;
}

/** Hides children after success (e.g. the form fields of a one-shot form). */
export function UnlessOk({ children }: { children: ReactNode }) {
  return useFormState().ok ? null : <>{children}</>;
}

/** Shows a value the action returned in `data`, as a copyable field or a link. */
export function ResultData({ field, label, as = "copy", prefixOrigin }: { field: string; label: string; as?: "copy" | "link"; prefixOrigin?: boolean }) {
  const v = useFormState().data?.[field];
  if (!v) return null;
  // Data only exists after a client-side action result, so window is available here.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const full = prefixOrigin && v.startsWith("/") ? origin + v : v;
  return as === "link" ? (
    <p className="mb-3 text-sm">
      {label}{" "}
      <a href={v} className="link break-all">
        {full}
      </a>
    </p>
  ) : (
    <div className="mb-3">
      <CopyField value={full} label={label} />
    </div>
  );
}

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import {
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  MinusCircleIcon,
  XCircleIcon,
} from "@heroicons/react/20/solid";
import { formatINR } from "@/domain/money";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({ variant = "primary", size, className, ...props }: ComponentProps<"button"> & { variant?: Variant; size?: "sm" }) {
  return <button className={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", className)} {...props} />;
}

export function ButtonLink({ variant = "primary", size, className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: "sm" }) {
  return <Link className={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", className)} {...props} />;
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-sm text-ink-muted">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx("card", className)}>
      {title || actions ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          {title ? <h2 className="text-base font-semibold">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      <div className={padded ? "p-4" : undefined}>{children}</div>
    </section>
  );
}

export type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "progress";

const TONE: Record<Tone, { cls: string; Icon: typeof CheckCircleIcon }> = {
  neutral: { cls: "bg-sunken text-ink-muted border-line", Icon: MinusCircleIcon },
  ok: { cls: "bg-ok-soft text-ok border-[#b9d8ca]", Icon: CheckCircleIcon },
  warn: { cls: "bg-warn-soft text-warn border-[#efd29c]", Icon: ExclamationTriangleIcon },
  danger: { cls: "bg-danger-soft text-danger border-[#f0c2bb]", Icon: XCircleIcon },
  info: { cls: "bg-info-soft text-info border-[#bcd3e6]", Icon: InformationCircleIcon },
  progress: { cls: "bg-info-soft text-info border-[#bcd3e6]", Icon: ClockIcon },
};

/** Status badge: icon + text, never colour alone. */
export function Badge({ tone = "neutral", children, icon = true }: { tone?: Tone; children: ReactNode; icon?: boolean }) {
  const t = TONE[tone];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", t.cls)}>
      {icon ? <t.Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      {children}
    </span>
  );
}

export function Money({ value, className }: { value: string | number | null | undefined; className?: string }) {
  return <span className={cx("tabular-nums", className)}>{formatINR(value ?? null)}</span>;
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: "warn" | "danger" }) {
  const body = (
    <>
      <div className="text-xs font-medium tracking-wide text-ink-muted uppercase">{label}</div>
      <div className={cx("mt-1 text-2xl font-semibold tabular-nums", tone === "warn" && "text-warn", tone === "danger" && "text-danger")}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-ink-muted">{hint}</div> : null}
    </>
  );
  return href ? (
    <Link href={href} className="card block p-4 transition-colors hover:border-line-strong">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "danger" | "ok"; title?: string; children: ReactNode }) {
  const t = TONE[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex gap-2 rounded-md border px-3 py-2 text-sm", t.cls)}>
      <t.Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className="text-ink">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, name, error, hint, children, required }: { label: string; name: string; error?: string[]; hint?: ReactNode; children: ReactNode; required?: boolean }) {
  return (
    <div>
      <label htmlFor={name} className="label">
        {label}
        {required ? <span className="text-danger" aria-hidden> *</span> : null}
      </label>
      {children}
      {hint && !error?.length ? (
        <p id={`${name}-hint`} className="hint">
          {hint}
        </p>
      ) : null}
      {error?.length ? (
        <p id={`${name}-error`} className="field-error">
          {error.join(". ")}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ name, error, className, ...props }: ComponentProps<"input"> & { name: string; error?: string[] }) {
  return (
    <input
      id={props.id ?? name}
      name={name}
      aria-invalid={error?.length ? true : undefined}
      aria-describedby={error?.length ? `${name}-error` : `${name}-hint`}
      className={cx("input", className)}
      {...props}
    />
  );
}

export function Select({ name, error, className, children, ...props }: ComponentProps<"select"> & { name: string; error?: string[] }) {
  return (
    <select id={props.id ?? name} name={name} aria-invalid={error?.length ? true : undefined} className={cx("input", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ name, error, className, ...props }: ComponentProps<"textarea"> & { name: string; error?: string[] }) {
  return <textarea id={props.id ?? name} name={name} aria-invalid={error?.length ? true : undefined} className={cx("input min-h-24", className)} {...props} />;
}

export function Checkbox({ name, label, defaultChecked, hint }: { name: string; label: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 accent-accent" />
      <span>
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-xs text-ink-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Pagination that preserves the current query string. */
export function Pagination({ page, pageCount, total, basePath, params }: { page: number; pageCount: number; total: number; basePath: string; params: Record<string, string | undefined> }) {
  if (pageCount <= 1) return <p className="mt-3 text-sm text-ink-muted">{total} {total === 1 ? "result" : "results"}</p>;
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") sp.set(k, v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">
      <span className="text-ink-muted">
        Page {page} of {pageCount} · {total} results
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link className="btn btn-secondary btn-sm" href={href(page - 1)} rel="prev">
            Previous
          </Link>
        ) : (
          <span className="btn btn-secondary btn-sm" aria-disabled="true">
            Previous
          </span>
        )}
        {page < pageCount ? (
          <Link className="btn btn-secondary btn-sm" href={href(page + 1)} rel="next">
            Next
          </Link>
        ) : (
          <span className="btn btn-secondary btn-sm" aria-disabled="true">
            Next
          </span>
        )}
      </span>
    </nav>
  );
}

export function DefinitionList({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="font-medium break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Column header link that toggles sort direction. */
export function SortHeader({ label, column, sort, dir, basePath, params, className }: { label: string; column: string; sort?: string; dir?: string; basePath: string; params: Record<string, string | undefined>; className?: string }) {
  const active = sort === column;
  const nextDir = active && dir !== "asc" ? "asc" : "desc";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && !["sort", "dir", "page"].includes(k)) sp.set(k, v);
  sp.set("sort", column);
  sp.set("dir", nextDir);
  return (
    <th scope="col" className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={`${basePath}?${sp.toString()}`} className="inline-flex items-center gap-1 hover:text-ink">
        {label}
        <span aria-hidden>{active ? (dir === "asc" ? "↑" : "↓") : "↕"}</span>
      </Link>
    </th>
  );
}

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/** A real screenshot of the application, captured from the demo workspace (see scripts/capture-screenshots.ts). */
export function Screenshot({ src, alt, caption, width, height, mobile }: { src: string; alt: string; caption?: string; width: number; height: number; mobile?: boolean }) {
  return (
    <figure className={mobile ? "mx-auto w-full max-w-[300px]" : "w-full"}>
      <div className={`overflow-hidden border border-line-strong bg-surface shadow-[var(--shadow-raised)] ${mobile ? "rounded-[22px] p-1.5" : "rounded-lg"}`}>
        <Image
  src={src}
  alt={alt}
  width={width}
  height={height}
  className={`h-auto w-full ${mobile ? "rounded-[17px]" : ""}`}
  sizes={mobile ? "300px" : "(min-width: 1024px) 720px, 100vw"}
  loading={src === "/screenshots/wholesaler-overview.png" ? "eager" : "lazy"}
/>
      </div>
      {caption ? <figcaption className="mt-2 text-center text-xs text-ink-muted">{caption}</figcaption> : null}
    </figure>
  );
}

export function Section({ children, className = "", tone }: { children: ReactNode; className?: string; tone?: "sunken" }) {
  return (
    <section className={`${tone === "sunken" ? "bg-sunken" : ""} ${className}`}>
      <div className="mx-auto max-w-[var(--spacing-content)] px-4 py-14 sm:px-6 sm:py-20">{children}</div>
    </section>
  );
}

export function SectionHeading({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      {eyebrow ? <p className="text-sm font-semibold text-accent">{eyebrow}</p> : null}
      <h2 className="mt-1 font-display text-3xl leading-tight text-ink sm:text-4xl">{title}</h2>
      {children ? <div className="mt-3 text-ink-muted">{children}</div> : null}
    </div>
  );
}

export function FeatureList({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.title} className="border-t border-line-strong pt-4">
          <dt className="font-semibold text-ink">{i.title}</dt>
          <dd className="mt-1 text-sm text-ink-muted">{i.body}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PageIntro({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="border-b border-line">
      <div className="mx-auto max-w-[var(--spacing-content)] px-4 pt-14 pb-10 sm:px-6 sm:pt-20">
        {eyebrow ? <p className="text-sm font-semibold text-accent">{eyebrow}</p> : null}
        <h1 className="mt-1 max-w-3xl font-display text-4xl leading-tight sm:text-5xl">{title}</h1>
        {children ? <div className="mt-4 max-w-2xl text-lg text-ink-muted">{children}</div> : null}
      </div>
    </div>
  );
}

export function CtaBand() {
  return (
    <Section tone="sunken">
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-3xl">Set up your business in one sitting.</h2>
          <p className="mt-2 text-ink-muted">Add your address and a few products. Retailers can find you and place orders the same day.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/register?type=wholesaler" className="btn btn-primary">
            Start with your business
          </Link>
          <Link href="/marketplace" className="btn btn-secondary">
            Explore the marketplace
          </Link>
        </div>
      </div>
    </Section>
  );
}

/** Marks a passage of legal text that has not been reviewed by a lawyer. */
export function LegalReview({ children }: { children?: ReactNode }) {
  return (
    <p className="my-3 rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm text-warn" role="note">
      <strong>Needs legal review.</strong> {children ?? "This section is a draft written for the product. A qualified lawyer must review it before launch."}
    </p>
  );
}

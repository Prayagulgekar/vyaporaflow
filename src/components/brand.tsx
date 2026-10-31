import Link from "next/link";

/** Wordmark: two offset bars suggesting stock flowing between shelves. */
export function Logo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-semibold text-ink" aria-label="VyaporaFlow home">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <rect x="1" y="1" width="24" height="24" rx="6" fill="#1f6b52" />
        <rect x="6" y="8" width="10" height="3" rx="1.5" fill="#faf7f2" />
        <rect x="10" y="15" width="10" height="3" rx="1.5" fill="#faf7f2" opacity="0.8" />
      </svg>
      {compact ? null : <span className="text-[17px] tracking-tight">VyaporaFlow</span>}
    </Link>
  );
}

export function DemoBanner() {
  return (
    <div className="bg-[#2a2722] px-4 py-1.5 text-center text-xs text-[#efe9df]">
      Demonstration mode: data is stored locally and every business shown is fictional. Do not enter real customer or payment information.
    </div>
  );
}

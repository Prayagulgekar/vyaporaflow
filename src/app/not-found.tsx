import Link from "next/link";
import { Logo } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-start justify-center gap-4 px-6">
      <Logo />
      <h1 className="font-display text-3xl">This page was not found</h1>
      <p className="text-ink-muted">The link may be old, or the record may belong to a business you do not have access to.</p>
      <div className="flex gap-2">
        <Link href="/app" className="btn btn-primary">
          Go to my workspace
        </Link>
        <Link href="/" className="btn btn-secondary">
          Home
        </Link>
      </div>
    </main>
  );
}

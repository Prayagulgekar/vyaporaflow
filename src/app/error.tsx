"use client";

import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const config = error.name === "ConfigError" || error.message.includes("configuration") || error.message.includes("db:setup");
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-3xl">{config ? "VyaporaFlow is not configured yet" : "Something went wrong"}</h1>
      {config ? (
        <pre className="overflow-x-auto rounded-md border border-line bg-surface p-3 text-xs whitespace-pre-wrap">{error.message}</pre>
      ) : (
        <p className="text-ink-muted">
          The request could not be completed. If you operate this server, the server log has the details (configuration problems name the missing setting). Nothing was saved twice: actions that change records are protected against repeats.
          {error.digest ? <span className="mt-2 block font-mono text-xs">Reference: {error.digest}</span> : null}
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn btn-primary" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="btn btn-secondary">
          Home
        </Link>
      </div>
    </main>
  );
}

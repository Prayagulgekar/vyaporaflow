"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { openWhatsApp } from "@/components/whatsapp";
import { isMobileUserAgent, normalizeWhatsAppPhone } from "@/lib/whatsapp";

type Status = { tone: "info" | "ok" | "error"; text: string } | null;

function canShareFiles(file: File): boolean {
  try {
    return typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  return isMobileUserAgent(navigator.userAgent, navigator.maxTouchPoints, uaData?.mobile);
}

/** Starts a normal browser download of the PDF (no JavaScript fetch needed). */
function startDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Download, share and WhatsApp a generated PDF.
 *
 * - "Share on WhatsApp": on phones that can share files (Web Share API level 2)
 *   the PDF goes straight to the share sheet, where the user picks WhatsApp and
 *   the chat. Everywhere else the PDF is downloaded and WhatsApp opens on the
 *   customer's chat with the message typed in; the user attaches the PDF.
 * - A wa.me / WhatsApp Web link can only carry text, never a file, and nothing
 *   is ever sent automatically: the user always presses Send in WhatsApp.
 */
export function DocumentShare({
  pdfUrl,
  fallbackFilename,
  title,
  phone,
  recipientName,
  message,
  testId,
}: {
  /** Route that returns the PDF inline, e.g. /w/documents/balance-due/<id>. */
  pdfUrl: string;
  fallbackFilename: string;
  title: string;
  phone: string | null | undefined;
  recipientName: string;
  /** WhatsApp message sent with the document. */
  message: string;
  testId?: string;
}) {
  const sep = pdfUrl.includes("?") ? "&" : "?";
  const downloadUrl = `${pdfUrl}${sep}download=1`;
  const [file, setFile] = useState<File | null>(null);
  const [filename, setFilename] = useState(fallbackFilename);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shareable, setShareable] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const loading = useRef(false);
  const recipient = normalizeWhatsAppPhone(phone, recipientName);

  // Fetch the PDF once, so the share sheet can open straight from the click
  // (browsers only allow navigator.share() during the click itself).
  useEffect(() => {
    if (loading.current) return;
    loading.current = true;
    let cancelled = false;
    fetch(pdfUrl, { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `The PDF could not be generated (error ${res.status}).`);
        const name = decodeURIComponent(res.headers.get("x-document-filename") ?? "") || fallbackFilename;
        const blob = await res.blob();
        if (cancelled) return;
        const f = new File([blob], name, { type: "application/pdf" });
        setFilename(name);
        setFile(f);
        setShareable(canShareFiles(f));
      })
      .catch((e: unknown) => !cancelled && setLoadError(e instanceof Error ? e.message : "The PDF could not be generated."));
    return () => {
      cancelled = true;
      loading.current = false;
    };
  }, [pdfUrl, fallbackFilename]);

  async function shareFile(): Promise<"shared" | "cancelled" | "unsupported"> {
    if (!file || !shareable) return "unsupported";
    try {
      await navigator.share({ files: [file], title, text: message });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      return "unsupported";
    }
  }

  async function onShareWhatsApp() {
    // Phones with file sharing: share sheet first (the user picks WhatsApp and the chat).
    if (shareable && isMobileDevice()) {
      const r = await shareFile();
      if (r === "shared") return setStatus({ tone: "ok", text: `Shared from your phone. In WhatsApp, choose ${recipientName}'s chat, check the message and press Send.` });
      if (r === "cancelled") return setStatus({ tone: "info", text: "Sharing was cancelled. Nothing was sent." });
    }
    // Everyone else: open the chat with the message, and download the PDF to attach.
    if (!recipient.ok) return setStatus({ tone: "error", text: recipient.error });
    openWhatsApp(recipient.digits, message);
    startDownload(downloadUrl, filename);
    setStatus({
      tone: "info",
      text: `WhatsApp is opening on ${recipientName}'s chat with the message typed in, and ${filename} is downloading. In WhatsApp, tap the attach (paperclip) button, choose Document, pick ${filename}, then press Send. WhatsApp links cannot attach files by themselves.`,
    });
  }

  async function onShareSheet() {
    const r = await shareFile();
    if (r === "shared") return setStatus({ tone: "ok", text: "Shared. If you chose WhatsApp, pick the chat and press Send there." });
    if (r === "cancelled") return setStatus({ tone: "info", text: "Sharing was cancelled. Nothing was sent." });
    startDownload(downloadUrl, filename);
    setStatus({ tone: "info", text: `This browser cannot share files directly, so ${filename} was downloaded instead. Attach it in WhatsApp, email or any other app.` });
  }

  const ready = Boolean(file);
  return (
    <div className="space-y-3" data-testid={testId ?? "document-share"} data-ready={ready ? "true" : "false"} data-can-share-files={shareable ? "true" : "false"}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={onShareWhatsApp} disabled={!ready && !loadError} data-testid="share-whatsapp">
          Share on WhatsApp
        </button>
        <a href={downloadUrl} download={filename} className="btn btn-secondary btn-sm" data-testid="download-pdf">
          Download PDF
        </a>
        <a href={pdfUrl} target="_blank" rel="noopener" className="btn btn-secondary btn-sm" data-testid="view-pdf">
          View PDF
        </a>
        {shareable ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onShareSheet} data-testid="share-sheet">
            Share PDF…
          </button>
        ) : null}
      </div>
      <p className="text-xs text-ink-muted">
        {loadError ? <span className="text-danger" role="alert">{loadError}</span> : ready ? <>Ready: <span className="font-medium text-ink">{filename}</span></> : "Preparing the PDF…"}
        {recipient.ok ? <> · WhatsApp to {recipientName} ({recipient.display})</> : <> · <span className="text-danger">{recipient.reason === "missing" ? `No mobile number for ${recipientName}` : `Invalid mobile number for ${recipientName}`}</span></>}
      </p>
      {status ? (
        <p role="status" data-testid="share-status" className={cx("rounded-md px-3 py-2 text-sm", status.tone === "error" ? "bg-danger-soft text-danger" : status.tone === "ok" ? "bg-ok-soft text-ok" : "bg-info-soft text-info")}>
          {status.text}
        </p>
      ) : null}
    </div>
  );
}

/** A button that reveals the share panel; the PDF is only generated once it is opened. */
export function SharePanelToggle({ label = "PDF and WhatsApp", children, testId }: { label?: string; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" className="btn btn-secondary btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid={testId ?? "share-toggle"}>
        {open ? "Hide sharing" : label}
      </button>
      {open ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

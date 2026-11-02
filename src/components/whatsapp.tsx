"use client";

import { useId, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { isMobileUserAgent, normalizeWhatsAppPhone, whatsappUrls } from "@/lib/whatsapp";

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  return isMobileUserAgent(navigator.userAgent, navigator.maxTouchPoints, uaData?.mobile);
}

/** Copies the message (best effort) so it can be pasted if a WhatsApp app ignores the prefilled text. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens WhatsApp on a chat with `digits` and the message typed in. Phones use
 * wa.me (the WhatsApp app); computers use WhatsApp Web, which always fills in
 * the text. Nothing is sent: the user presses Send in WhatsApp.
 */
export function openWhatsApp(digits: string, message: string) {
  const urls = whatsappUrls(digits, message);
  window.open(isMobileDevice() ? urls.mobile : urls.desktop, "_blank", "noopener,noreferrer");
}

function WhatsAppIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.4-.3Z" />
    </svg>
  );
}

/**
 * One-click "WhatsApp" button for a single prepared message. With an invalid
 * or missing number it explains the problem instead of opening a broken chat,
 * or renders nothing when `hideWhenMissing` is set (contact buttons that are
 * simply not shown when the business has no number).
 */
export function WhatsAppButton({
  phone,
  message,
  recipientName,
  label = "WhatsApp",
  size = "sm",
  className,
  hideWhenMissing,
}: {
  phone: string | null | undefined;
  message: string;
  recipientName?: string | null;
  label?: string;
  size?: "sm" | "md";
  className?: string;
  hideWhenMissing?: boolean;
}) {
  const [note, setNote] = useState<string | null>(null);
  const result = normalizeWhatsAppPhone(phone, recipientName);
  if (!result.ok && hideWhenMissing) return null;
  const cls = cx("btn btn-secondary", size === "sm" && "btn-sm", className);
  if (!result.ok) {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <button type="button" className={cls} aria-disabled="true" data-testid="whatsapp-button" data-whatsapp-error={result.reason} onClick={() => setNote(result.error)}>
          <WhatsAppIcon />
          {label}
        </button>
        {note ? <span role="alert" className="max-w-xs text-xs text-danger">{note}</span> : null}
      </span>
    );
  }
  const urls = whatsappUrls(result.digits, message);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <a
        href={urls.mobile}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
        data-testid="whatsapp-button"
        data-desktop-href={urls.desktop}
        title={`Open WhatsApp with ${result.display}`}
        onClick={(e) => {
          void copyText(message).then((ok) => ok && setNote("Message copied. If WhatsApp doesn't fill it in, paste it."));
          if (!isMobileDevice()) {
            e.preventDefault();
            window.open(urls.desktop, "_blank", "noopener,noreferrer");
          }
        }}
      >
        <WhatsAppIcon />
        {label}
      </a>
      {note ? <span role="status" className="text-xs text-ink-muted">{note}</span> : null}
    </span>
  );
}

export interface WhatsAppMessageOption {
  id: string;
  label: string;
  message: string;
}

/**
 * WhatsApp button that opens a small composer: choose the prepared message,
 * review or edit it, then open WhatsApp with it typed in.
 */
export function WhatsAppComposer({
  phone,
  recipientName,
  options,
  defaultId,
  label = "WhatsApp",
  size = "sm",
  className,
  footnote,
}: {
  phone: string | null | undefined;
  recipientName: string;
  options: WhatsAppMessageOption[];
  defaultId?: string;
  label?: string;
  size?: "sm" | "md";
  className?: string;
  footnote?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const first = options.find((o) => o.id === defaultId) ?? options[0];
  const [choice, setChoice] = useState(first?.id ?? "");
  const [text, setText] = useState(first?.message ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const result = normalizeWhatsAppPhone(phone, recipientName);
  if (!first) return null;

  return (
    <>
      <button
        type="button"
        className={cx("btn btn-secondary", size === "sm" && "btn-sm", className)}
        data-testid="whatsapp-composer"
        onClick={() => {
          setStatus(null);
          ref.current?.showModal();
        }}
      >
        <WhatsAppIcon />
        {label}
      </button>
      <dialog
        ref={ref}
        className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink shadow-[var(--shadow-raised)] backdrop:bg-black/30"
        aria-labelledby={`${id}-title`}
      >
        <div className="p-5">
          <h2 id={`${id}-title`} className="text-lg font-semibold">
            WhatsApp {recipientName}
          </h2>
          {result.ok ? (
            <p className="mt-1 text-sm text-ink-muted" data-testid="whatsapp-recipient">
              To {result.display}
            </p>
          ) : (
            <p role="alert" className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" data-testid="whatsapp-error">
              {result.error}
            </p>
          )}
          {options.length > 1 ? (
            <div className="mt-4">
              <label className="label" htmlFor={`${id}-type`}>
                Message
              </label>
              <select
                id={`${id}-type`}
                className="input"
                value={choice}
                data-testid="whatsapp-template"
                onChange={(e) => {
                  const o = options.find((x) => x.id === e.target.value);
                  setChoice(e.target.value);
                  if (o) setText(o.message);
                }}
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="mt-3">
            <label className="label" htmlFor={`${id}-text`}>
              Review the message
            </label>
            <textarea id={`${id}-text`} className="input min-h-48 font-sans text-sm" value={text} onChange={(e) => setText(e.target.value)} data-testid="whatsapp-text" />
            <p className="hint">{footnote ?? "WhatsApp opens with this message typed in. Nothing is sent until you press Send in WhatsApp."}</p>
          </div>
          {status ? (
            <p role="status" className="mt-2 text-sm text-ink-muted">
              {status}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>
              Close
            </button>
            <button type="button" className="btn btn-secondary" onClick={async () => setStatus((await copyText(text)) ? "Message copied." : "Copy is not available in this browser. Select the text and copy it.")}>
              Copy message
            </button>
            {result.ok ? (
              <button
                type="button"
                className="btn btn-primary"
                data-testid="whatsapp-open"
                onClick={() => {
                  void copyText(text);
                  openWhatsApp(result.digits, text);
                  setStatus("WhatsApp opened in a new tab or app. Check the message and press Send there.");
                }}
              >
                <WhatsAppIcon />
                Open WhatsApp
              </button>
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}

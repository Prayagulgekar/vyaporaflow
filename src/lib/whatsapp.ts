/**
 * Central WhatsApp click-to-chat helpers.
 *
 * VyaporaFlow never sends WhatsApp messages itself. These helpers build a link
 * that opens WhatsApp (app or WhatsApp Web) on a chat with the right person and
 * a message already typed in. The user reviews the message and presses Send.
 * A click-to-chat link cannot attach files: PDFs are shared with the device's
 * share sheet or downloaded and attached by hand (see document-share.tsx).
 *
 * This module is pure and safe to import on the server and in the browser.
 */

export type WhatsAppPhoneResult =
  | { ok: true; /** International digits without "+", e.g. 919876543210 */ digits: string; /** "+91 98765 43210" */ display: string }
  | { ok: false; reason: "missing" | "invalid"; error: string };

/**
 * Normalises a phone number to the digits-only international form WhatsApp
 * expects (country code, no "+", spaces, dashes, brackets or leading zero).
 *
 * Indian numbers may be typed as 98765 43210, 098765-43210, +91 98765 43210,
 * 91 9876543210, 0091 98765 43210 or +91 (0) 98765 43210. Indian numbers must
 * be mobile numbers (10 digits starting 6-9): landlines cannot use WhatsApp,
 * and wa.me opens WhatsApp without a chat (and without the message) for an
 * invalid number. Numbers with another country code are accepted as E.164.
 */
export function normalizeWhatsAppPhone(phone: string | null | undefined, name?: string | null): WhatsAppPhoneResult {
  const who = name?.trim() ? name.trim() : "this contact";
  const raw = (phone ?? "").trim();
  if (!raw) return { ok: false, reason: "missing", error: `No phone number is saved for ${who}. Add a mobile number to their profile to message them on WhatsApp.` };
  if (/[A-Za-z]/.test(raw)) return invalid(raw, who);
  const hadPlus = raw.startsWith("+");
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2); // 0091… international dialling prefix
  if (!hadPlus && d.length === 11 && d.startsWith("0")) d = d.slice(1); // 098765 43210 (trunk prefix)
  if (d.length === 13 && d.startsWith("910")) d = `91${d.slice(3)}`; // +91 0 98765 43210
  if (d.length === 10 && (!hadPlus || /^[6-9]/.test(d))) d = `91${d}`; // 98765 43210 (or +98765 43210 typed by mistake)
  if (d.startsWith("91") && d.length === 12) {
    return /^91[6-9]\d{9}$/.test(d) ? { ok: true, digits: d, display: `+91 ${d.slice(2, 7)} ${d.slice(7)}` } : invalid(raw, who);
  }
  if (hadPlus && !d.startsWith("91") && /^[1-9]\d{7,14}$/.test(d)) return { ok: true, digits: d, display: `+${d}` };
  return invalid(raw, who);
}

function invalid(raw: string, who: string): WhatsAppPhoneResult {
  return {
    ok: false,
    reason: "invalid",
    error: `The number saved for ${who} (${raw}) is not a valid mobile number for WhatsApp. Use a 10-digit Indian mobile number, for example 98765 43210 or +91 98765 43210.`,
  };
}

/** Digits-only WhatsApp number, or null when the number is missing or invalid. */
export function whatsappPhone(phone: string | null | undefined): string | null {
  const r = normalizeWhatsAppPhone(phone);
  return r.ok ? r.digits : null;
}

/**
 * Click-to-chat URLs. `mobile` (wa.me) opens the WhatsApp app on phones.
 * `desktop` (WhatsApp Web) always fills in the message on computers; the
 * Windows desktop app can open the chat but leave the message box empty.
 * The message is percent-encoded as UTF-8, so ₹, line breaks, &, #, ? and
 * emoji survive.
 */
export function whatsappUrls(digits: string, message: string): { mobile: string; desktop: string } {
  const text = encodeURIComponent(message);
  return {
    mobile: `https://wa.me/${digits}?text=${text}`,
    desktop: `https://web.whatsapp.com/send?phone=${digits}&text=${text}`,
  };
}

/** wa.me link with a prefilled message, or null when the number is missing or invalid. */
export function whatsappUrl(phone: string | null | undefined, message: string): string | null {
  const digits = whatsappPhone(phone);
  return digits ? whatsappUrls(digits, message).mobile : null;
}

/** True on phones and tablets, where wa.me opens the WhatsApp app. */
export function isMobileUserAgent(userAgent: string, maxTouchPoints = 0, uaDataMobile?: boolean): boolean {
  if (uaDataMobile) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) || (maxTouchPoints > 1 && /Macintosh/.test(userAgent));
}

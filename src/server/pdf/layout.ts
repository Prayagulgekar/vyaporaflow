/**
 * Small A4 document layout engine on top of pdf-lib: a branded header on every
 * page, wrapped text, label/value blocks and tables that break across pages
 * with their header row repeated, and "Page x of y" footers.
 *
 * Pure JavaScript with an embedded font, so it runs the same in `next dev`,
 * `next start`, serverless hosting and the tests.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { NOTO_SANS_BOLD, NOTO_SANS_REGULAR } from "./fonts/noto-sans";

export const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const CONTENT_W = A4.width - MARGIN * 2;
const FOOTER_H = 44;

export const COLORS = {
  brand: rgb(0x1f / 255, 0x6b / 255, 0x52 / 255), // VyaporaFlow green
  brandSoft: rgb(0xe3 / 255, 0xef / 255, 0xe9 / 255),
  blue: rgb(0x1e / 255, 0x5a / 255, 0x88 / 255),
  blueSoft: rgb(0xe5 / 255, 0xee / 255, 0xf6 / 255),
  ink: rgb(0x1d / 255, 0x1b / 255, 0x18 / 255),
  muted: rgb(0x59 / 255, 0x54 / 255, 0x4c / 255),
  faint: rgb(0x8a / 255, 0x83 / 255, 0x78 / 255),
  line: rgb(0xe4 / 255, 0xdd / 255, 0xd1 / 255),
  sunken: rgb(0xf6 / 255, 0xf3 / 255, 0xee / 255),
  danger: rgb(0xa8 / 255, 0x26 / 255, 0x1b / 255),
  white: rgb(1, 1, 1),
};

export interface TextOpts {
  size?: number;
  bold?: boolean;
  color?: RGB;
  align?: "left" | "right" | "center";
  lineGap?: number;
}

export interface Column {
  header: string;
  /** Share of the table width. */
  width: number;
  align?: "left" | "right" | "center";
}

export interface TableRow {
  cells: string[];
  bold?: boolean;
  shade?: boolean;
  color?: RGB;
}

export interface HeaderInfo {
  /** Document title, e.g. "Balance due statement". */
  title: string;
  /** Short subtitle under the title, e.g. "Not a tax invoice". */
  subtitle?: string;
  /** Business issuing the document (top left). */
  issuer: string;
  /** Lines under the issuer name: address, GSTIN, phone. */
  issuerLines: string[];
  /** Label/value pairs printed under the title (top right). */
  meta: [string, string][];
  /** Shown on later pages next to the title, e.g. the document number. */
  shortRef?: string;
  /** Large diagonal watermark, e.g. VOID or REVERSED. */
  watermark?: string;
}

export class PdfLayout {
  readonly doc: PDFDocument;
  private regular!: PDFFont;
  private bold!: PDFFont;
  private supported = new Set<number>();
  page!: PDFPage;
  /** Current baseline position from the bottom of the page. */
  y = 0;
  private header!: HeaderInfo;
  private footerNote = "";

  private constructor(doc: PDFDocument) {
    this.doc = doc;
  }

  static async create(header: HeaderInfo, opts: { footerNote: string; author: string; subject?: string }): Promise<PdfLayout> {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const l = new PdfLayout(doc);
    l.regular = await doc.embedFont(Buffer.from(NOTO_SANS_REGULAR, "base64"), { subset: false });
    l.bold = await doc.embedFont(Buffer.from(NOTO_SANS_BOLD, "base64"), { subset: false });
    for (const cp of l.regular.getCharacterSet()) l.supported.add(cp);
    l.header = header;
    l.footerNote = opts.footerNote;
    doc.setTitle(`${header.title}${header.shortRef ? ` ${header.shortRef}` : ""}`);
    doc.setAuthor(opts.author);
    doc.setSubject(opts.subject ?? header.title);
    doc.setCreator("VyaporaFlow");
    doc.setProducer("VyaporaFlow");
    doc.setCreationDate(new Date());
    l.firstPage();
    return l;
  }

  /** Replaces characters the font cannot draw (e.g. Devanagari) with "?" so the PDF always renders. */
  clean(text: string): string {
    let out = "";
    for (const ch of text.replace(/\r?\n/g, " ").replace(/\t/g, " ")) {
      const cp = ch.codePointAt(0)!;
      out += this.supported.has(cp) ? ch : "?";
    }
    return out;
  }

  font(bold?: boolean) {
    return bold ? this.bold : this.regular;
  }

  width(text: string, size: number, bold?: boolean): number {
    return this.font(bold).widthOfTextAtSize(this.clean(text), size);
  }

  /** Splits text into lines that fit `maxWidth`, breaking long words if needed. */
  wrap(text: string, size: number, maxWidth: number, bold?: boolean): string[] {
    const font = this.font(bold);
    const words = this.clean(text).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    const fits = (s: string) => font.widthOfTextAtSize(s, size) <= maxWidth;
    for (let word of words) {
      while (!fits(word)) {
        let cut = word.length - 1;
        while (cut > 1 && !fits(word.slice(0, cut))) cut--;
        if (current) {
          lines.push(current);
          current = "";
        }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const next = current ? `${current} ${word}` : word;
      if (fits(next)) current = next;
      else {
        lines.push(current);
        current = word;
      }
    }
    if (current || lines.length === 0) lines.push(current);
    return lines;
  }

  private draw(text: string, x: number, y: number, size: number, bold?: boolean, color: RGB = COLORS.ink) {
    this.page.drawText(this.clean(text), { x, y, size, font: this.font(bold), color });
  }

  /** Draws `text` at an absolute position, aligned within `width`. */
  drawAt(text: string, x: number, y: number, width: number, o: TextOpts = {}) {
    const size = o.size ?? 9.5;
    const w = this.width(text, size, o.bold);
    const dx = o.align === "right" ? width - w : o.align === "center" ? (width - w) / 2 : 0;
    this.draw(text, x + dx, y, size, o.bold, o.color);
  }

  private brandMark(x: number, y: number, s: number) {
    this.page.drawRectangle({ x, y, width: s, height: s, color: COLORS.brand });
    this.page.drawRectangle({ x: x + s * 0.22, y: y + s * 0.56, width: s * 0.4, height: s * 0.12, color: COLORS.white });
    this.page.drawRectangle({ x: x + s * 0.38, y: y + s * 0.3, width: s * 0.4, height: s * 0.12, color: COLORS.white, opacity: 0.8 });
  }

  private addPage(): PDFPage {
    this.page = this.doc.addPage([A4.width, A4.height]);
    // Brand band across the top.
    this.page.drawRectangle({ x: 0, y: A4.height - 6, width: A4.width * 0.62, height: 6, color: COLORS.brand });
    this.page.drawRectangle({ x: A4.width * 0.62, y: A4.height - 6, width: A4.width * 0.38, height: 6, color: COLORS.blue });
    if (this.header.watermark) {
      const size = 96;
      const w = this.bold.widthOfTextAtSize(this.header.watermark, size);
      this.page.drawText(this.header.watermark, {
        x: A4.width / 2 - (w / 2) * Math.cos(Math.PI / 6),
        y: A4.height / 2 - (w / 2) * Math.sin(Math.PI / 6),
        size,
        font: this.bold,
        color: COLORS.danger,
        opacity: 0.12,
        rotate: degrees(30),
      });
    }
    return this.page;
  }

  private firstPage() {
    this.addPage();
    const h = this.header;
    const top = A4.height - MARGIN;
    const leftW = CONTENT_W * 0.55;
    const rightX = MARGIN + CONTENT_W * 0.58;
    const rightW = CONTENT_W * 0.42;
    // Issuer (left)
    let ly = top - 6;
    for (const l of this.wrap(h.issuer, 16, leftW, true)) {
      this.draw(l, MARGIN, ly, 16, true);
      ly -= 19;
    }
    for (const line of h.issuerLines) {
      for (const l of this.wrap(line, 8.5, leftW)) {
        this.draw(l, MARGIN, ly, 8.5, false, COLORS.muted);
        ly -= 11.5;
      }
    }
    // Title and meta (right)
    let ry = top - 6;
    for (const l of this.wrap(h.title.toUpperCase(), 13, rightW, true)) {
      this.drawAt(l, rightX, ry, rightW, { size: 13, bold: true, color: COLORS.brand, align: "right" });
      ry -= 16;
    }
    if (h.subtitle) {
      for (const l of this.wrap(h.subtitle, 8.5, rightW)) {
        this.drawAt(l, rightX, ry, rightW, { size: 8.5, color: COLORS.muted, align: "right" });
        ry -= 11;
      }
    }
    ry -= 3;
    for (const [k, v] of h.meta) {
      const label = `${k}: `;
      const vw = this.width(v, 9, true);
      const lw = this.width(label, 9);
      this.draw(v, rightX + rightW - vw, ry, 9, true);
      this.draw(label, rightX + rightW - vw - lw, ry, 9, false, COLORS.muted);
      ry -= 12.5;
    }
    this.y = Math.min(ly, ry) - 8;
    this.rule();
    this.y -= 14;
  }

  private continuationPage() {
    this.addPage();
    const top = A4.height - MARGIN + 4;
    const left = this.wrap(this.header.issuer, 10, CONTENT_W * 0.5, true)[0] ?? "";
    this.draw(left, MARGIN, top - 8, 10, true);
    const right = `${this.header.title}${this.header.shortRef ? ` · ${this.header.shortRef}` : ""} (continued)`;
    this.drawAt(right, MARGIN + CONTENT_W * 0.45, top - 8, CONTENT_W * 0.55, { size: 9, color: COLORS.muted, align: "right" });
    this.y = top - 18;
    this.rule();
    this.y -= 14;
  }

  /** Starts a new page when less than `height` points remain above the footer. */
  ensure(height: number): boolean {
    if (this.y - height < MARGIN + FOOTER_H) {
      this.continuationPage();
      return true;
    }
    return false;
  }

  rule(color: RGB = COLORS.line, thickness = 0.8) {
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: MARGIN + CONTENT_W, y: this.y }, thickness, color });
  }

  gap(points: number) {
    this.y -= points;
  }

  /** A paragraph across the content width (or `width` from `x`). */
  paragraph(text: string, o: TextOpts & { x?: number; width?: number } = {}) {
    const size = o.size ?? 9.5;
    const lh = size * 1.35 + (o.lineGap ?? 0);
    const x = o.x ?? MARGIN;
    const width = o.width ?? CONTENT_W;
    for (const l of this.wrap(text, size, width, o.bold)) {
      this.ensure(lh);
      this.drawAt(l, x, this.y - size, width, o);
      this.y -= lh;
    }
  }

  /** Section heading with a coloured marker. */
  heading(text: string) {
    this.ensure(40);
    this.y -= 4;
    this.page.drawRectangle({ x: MARGIN, y: this.y - 11, width: 3, height: 12, color: COLORS.brand });
    this.draw(text, MARGIN + 8, this.y - 10, 11, true);
    this.y -= 20;
  }

  /** Two blocks side by side (e.g. "Bill to" and "Statement details"). */
  parties(blocks: { label: string; lines: string[]; strong?: string }[]) {
    const n = blocks.length;
    const colW = (CONTENT_W - (n - 1) * 16) / n;
    const heights = blocks.map((b) => {
      let h = 14;
      if (b.strong) h += this.wrap(b.strong, 10.5, colW - 16, true).length * 13.5;
      for (const l of b.lines) h += this.wrap(l, 8.8, colW - 16).length * 11.5;
      return h + 10;
    });
    const boxH = Math.max(...heights);
    this.ensure(boxH + 8);
    blocks.forEach((b, i) => {
      const x = MARGIN + i * (colW + 16);
      this.page.drawRectangle({ x, y: this.y - boxH, width: colW, height: boxH, color: COLORS.sunken, borderColor: COLORS.line, borderWidth: 0.6 });
      let y = this.y - 13;
      this.draw(b.label.toUpperCase(), x + 8, y, 7.5, true, COLORS.muted);
      y -= 14;
      if (b.strong) {
        for (const l of this.wrap(b.strong, 10.5, colW - 16, true)) {
          this.draw(l, x + 8, y, 10.5, true);
          y -= 13.5;
        }
      }
      for (const line of b.lines) {
        for (const l of this.wrap(line, 8.8, colW - 16)) {
          this.draw(l, x + 8, y, 8.8, false, COLORS.ink);
          y -= 11.5;
        }
      }
    });
    this.y -= boxH + 14;
  }

  /** Summary tiles, e.g. Total invoiced / Payments / Outstanding. The last one can be highlighted. */
  tiles(items: { label: string; value: string; highlight?: boolean; tone?: "danger" }[]) {
    const perRow = Math.min(items.length, 4);
    const w = (CONTENT_W - (perRow - 1) * 10) / perRow;
    const h = 46;
    for (let i = 0; i < items.length; i += perRow) {
      this.ensure(h + 10);
      items.slice(i, i + perRow).forEach((t, j) => {
        const x = MARGIN + j * (w + 10);
        const bg = t.highlight ? COLORS.brand : COLORS.sunken;
        this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, color: bg, borderColor: t.highlight ? COLORS.brand : COLORS.line, borderWidth: 0.6 });
        this.drawAt(t.label, x + 8, this.y - 15, w - 16, { size: 7.8, color: t.highlight ? COLORS.white : COLORS.muted });
        const size = this.width(t.value, 13, true) > w - 16 ? 10.5 : 13;
        this.drawAt(t.value, x + 8, this.y - 35, w - 16, { size, bold: true, color: t.highlight ? COLORS.white : t.tone === "danger" ? COLORS.danger : COLORS.ink });
      });
      this.y -= h + 10;
    }
  }

  /** Label/value rows, right-aligned values (e.g. totals). */
  totals(rows: { label: string; value: string; bold?: boolean; rule?: boolean }[], width = CONTENT_W * 0.48) {
    const x = MARGIN + CONTENT_W - width;
    for (const r of rows) {
      this.ensure(16);
      if (r.rule) {
        this.page.drawLine({ start: { x, y: this.y + 2 }, end: { x: x + width, y: this.y + 2 }, thickness: 0.8, color: COLORS.ink });
        this.y -= 3;
      }
      this.drawAt(r.label, x, this.y - 10, width * 0.6, { size: r.bold ? 10 : 9.2, bold: r.bold, color: r.bold ? COLORS.ink : COLORS.muted });
      this.drawAt(r.value, x + width * 0.4, this.y - 10, width * 0.6, { size: r.bold ? 10 : 9.2, bold: r.bold, align: "right" });
      this.y -= r.bold ? 16 : 14;
    }
  }

  /** A table that continues on the next page with its header repeated. */
  table(columns: Column[], rows: TableRow[], opts: { size?: number; empty?: string } = {}) {
    const size = opts.size ?? 8.4;
    const pad = 4;
    const total = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * CONTENT_W);
    const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((s, w) => s + w, 0));
    const lh = size * 1.3;

    const drawHeader = () => {
      const lines = columns.map((c, i) => this.wrap(c.header, size - 0.6, widths[i]! - pad * 2, true));
      const h = Math.max(...lines.map((l) => l.length)) * lh + pad * 2;
      this.page.drawRectangle({ x: MARGIN, y: this.y - h, width: CONTENT_W, height: h, color: COLORS.brandSoft });
      columns.forEach((c, i) => {
        lines[i]!.forEach((l, k) => this.drawAt(l, xs[i]! + pad, this.y - pad - (k + 1) * lh + 2.5, widths[i]! - pad * 2, { size: size - 0.6, bold: true, color: COLORS.brand, align: c.align }));
      });
      this.y -= h;
      return h;
    };

    this.ensure(lh * 4 + pad * 4);
    drawHeader();
    if (rows.length === 0) {
      this.y -= 4;
      this.drawAt(opts.empty ?? "No entries.", MARGIN, this.y - size - 4, CONTENT_W, { size, color: COLORS.muted, align: "center" });
      this.y -= size + 14;
      return;
    }
    rows.forEach((r, ri) => {
      const lines = r.cells.map((c, i) => this.wrap(c ?? "", size, widths[i]! - pad * 2, r.bold));
      const h = Math.max(...lines.map((l) => l.length)) * lh + pad * 2;
      if (this.ensure(h + 2)) drawHeader();
      if (r.shade) this.page.drawRectangle({ x: MARGIN, y: this.y - h, width: CONTENT_W, height: h, color: COLORS.sunken });
      else if (ri % 2 === 1) this.page.drawRectangle({ x: MARGIN, y: this.y - h, width: CONTENT_W, height: h, color: rgb(0.985, 0.98, 0.97) });
      columns.forEach((c, i) => {
        lines[i]!.forEach((l, k) => this.drawAt(l, xs[i]! + pad, this.y - pad - (k + 1) * lh + 2.5, widths[i]! - pad * 2, { size, bold: r.bold, color: r.color, align: c.align }));
      });
      this.y -= h;
      this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: MARGIN + CONTENT_W, y: this.y }, thickness: 0.4, color: COLORS.line });
    });
    this.y -= 10;
  }

  /** A highlighted note box (e.g. "This is not a tax invoice"). */
  note(text: string, tone: "info" | "warn" = "info") {
    const size = 8.6;
    const lines = this.wrap(text, size, CONTENT_W - 20);
    const h = lines.length * size * 1.35 + 12;
    this.ensure(h + 6);
    this.page.drawRectangle({ x: MARGIN, y: this.y - h, width: CONTENT_W, height: h, color: tone === "info" ? COLORS.blueSoft : rgb(0.984, 0.937, 0.851), borderColor: tone === "info" ? COLORS.blue : rgb(0.54, 0.33, 0), borderWidth: 0.6 });
    lines.forEach((l, i) => this.drawAt(l, MARGIN + 10, this.y - 6 - (i + 1) * size * 1.35 + 2, CONTENT_W - 20, { size, color: COLORS.ink }));
    this.y -= h + 10;
  }

  /** Adds footers and returns the PDF bytes. */
  async finish(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    const generated = `Generated with VyaporaFlow on ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })} IST`;
    pages.forEach((p, i) => {
      this.page = p;
      const y = MARGIN - 4;
      p.drawLine({ start: { x: MARGIN, y: y + 22 }, end: { x: MARGIN + CONTENT_W, y: y + 22 }, thickness: 0.6, color: COLORS.line });
      this.brandMark(MARGIN, y + 2, 11);
      this.draw("VyaporaFlow", MARGIN + 15, y + 4, 8, true, COLORS.brand);
      const noteLines = this.wrap(this.footerNote, 7, CONTENT_W - 170);
      noteLines.slice(0, 2).forEach((l, k) => this.draw(l, MARGIN + 72, y + 9 - k * 9, 7, false, COLORS.faint));
      this.drawAt(`Page ${i + 1} of ${pages.length}`, MARGIN + CONTENT_W - 90, y + 4, 90, { size: 8, color: COLORS.muted, align: "right" });
      if (i === 0) this.drawAt(generated, MARGIN, y - 8, CONTENT_W, { size: 6.8, color: COLORS.faint, align: "right" });
    });
    return this.doc.save({ useObjectStreams: true });
  }
}

/** Safe file name part: letters, digits and dashes. */
export function fileSlug(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, " ")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60) || "document"
  );
}

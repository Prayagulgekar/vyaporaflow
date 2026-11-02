import { NextResponse } from "next/server";
import type { PdfFile } from "@/server/documents";

/** PDF HTTP response with a meaningful file name (ASCII fallback plus RFC 5987 form). */
export function pdfResponse(file: PdfFile, download: boolean): NextResponse {
  const ascii = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new NextResponse(Buffer.from(file.bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "content-length": String(file.bytes.byteLength),
      "cache-control": "private, no-store",
      "x-document-filename": encodeURIComponent(file.filename),
    },
  });
}

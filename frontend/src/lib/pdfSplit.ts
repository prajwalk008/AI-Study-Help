import { PDFDocument } from "pdf-lib";
import { MAX_PART_BYTES, SPLIT_TARGET_BYTES } from "./uploadLimits";

export interface PdfPart {
  blob: Blob;
  pageOffset: number;
  pageCount: number;
  partIndex: number;
}

async function buildPartBytes(src: PDFDocument, start: number, end: number): Promise<Uint8Array> {
  const partDoc = await PDFDocument.create();
  const pageIndices = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const copied = await partDoc.copyPages(src, pageIndices);
  copied.forEach((p) => partDoc.addPage(p));
  return partDoc.save();
}

/** Greedily pack pages into parts, shrinking ranges until each part is <= 1 MB. */
export async function splitPdfIntoParts(file: File, onProgress?: (pct: number) => void): Promise<PdfPart[]> {
  const bytes = await file.arrayBuffer();
  onProgress?.(1);
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const totalPages = src.getPageCount();
  if (totalPages === 0) return [];

  const fileSize = bytes.byteLength;
  if (fileSize <= MAX_PART_BYTES) {
    return [
      {
        blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        pageOffset: 0,
        pageCount: totalPages,
        partIndex: 0,
      },
    ];
  }

  const bytesPerPage = fileSize / totalPages;
  let guessPages = Math.max(1, Math.floor(SPLIT_TARGET_BYTES / bytesPerPage));

  const parts: PdfPart[] = [];
  let start = 0;

  while (start < totalPages) {
    let end = Math.min(start + guessPages - 1, totalPages - 1);
    let partBytes = await buildPartBytes(src, start, end);

    while (partBytes.byteLength > MAX_PART_BYTES && end > start) {
      end = start + Math.max(0, Math.floor((end - start) / 2));
      partBytes = await buildPartBytes(src, start, end);
    }

    if (partBytes.byteLength > MAX_PART_BYTES) {
      throw new Error(
        `Page ${start + 1} alone exceeds 1 MB (likely a high-resolution scan). Try compressing the PDF first.`
      );
    }

    parts.push({
      blob: new Blob([new Uint8Array(partBytes)], { type: "application/pdf" }),
      pageOffset: start,
      pageCount: end - start + 1,
      partIndex: parts.length,
    });

    guessPages = Math.max(1, end - start + 1);
    start = end + 1;
    onProgress?.(start / totalPages);
  }

  return parts;
}

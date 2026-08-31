import { PDFDocument } from "pdf-lib";
import { MAX_PART_BYTES, SPLIT_TARGET_BYTES } from "./uploadLimits";

export interface PdfPart {
  blob: Blob;
  pageOffset: number;
  pageCount: number;
  partIndex: number;
}

export async function splitPdfIntoParts(file: File, onProgress?: (pct: number) => void): Promise<PdfPart[]> {
  const bytes = await file.arrayBuffer();
  onProgress?.(1);
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const totalPages = src.getPageCount();
  if (totalPages === 0) return [];

  const fileSize = bytes.byteLength;
  if (fileSize <= SPLIT_TARGET_BYTES) {
    return [
      {
        blob: new Blob([bytes], { type: "application/pdf" }),
        pageOffset: 0,
        pageCount: totalPages,
        partIndex: 0,
      },
    ];
  }

  const bytesPerPage = fileSize / totalPages;
  const pagesPerPart = Math.max(1, Math.floor(SPLIT_TARGET_BYTES / bytesPerPage));
  const parts: PdfPart[] = [];
  let partIndex = 0;

  for (let start = 0; start < totalPages; start += pagesPerPart) {
    const end = Math.min(start + pagesPerPart - 1, totalPages - 1);
    const partDoc = await PDFDocument.create();
    const pageIndices = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const copied = await partDoc.copyPages(src, pageIndices);
    copied.forEach((p) => partDoc.addPage(p));
    const partBytes = await partDoc.save();
    if (partBytes.byteLength > MAX_PART_BYTES) {
      throw new Error("A PDF part exceeded 1 MB. Try a smaller file or fewer images per page.");
    }
    parts.push({
      blob: new Blob([new Uint8Array(partBytes)], { type: "application/pdf" }),
      pageOffset: start,
      pageCount: end - start + 1,
      partIndex: partIndex++,
    });
    onProgress?.((end + 1) / totalPages);
  }
  return parts;
}

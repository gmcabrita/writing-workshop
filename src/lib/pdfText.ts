// The legacy build carries polyfills (Math.sumPrecise and friends) that the
// modern build assumes, so PDFs with embedded fonts parse in browsers a
// release or two behind.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";
// Loading the worker module on the main thread registers
// `globalThis.pdfjsWorker`, which makes pdf.js parse in-process. The app is
// a single inlined HTML file, so a separate worker script has no URL.
import "pdfjs-dist/legacy/build/pdf.worker.min.mjs";

const isTextItem = (item: TextItem | TextMarkedContent): item is TextItem => "str" in item;

/**
 * Join one page's text runs. pdf.js marks line ends with `hasEOL`; runs on
 * the same line are concatenated as-is because the spacing is already in
 * the run text.
 */
const pageText = (items: ReadonlyArray<TextItem | TextMarkedContent>): string =>
  items
    .flatMap((item) => (isTextItem(item) ? [item.hasEOL ? `${item.str}\n` : item.str] : []))
    .join("")
    .replaceAll(/[ \t]+\n/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();

/** Plain text of every page, pages separated by a blank line. */
export const extractPdfText = async (data: ArrayBuffer): Promise<string> => {
  const task = getDocument({ data });
  const pdf = await task.promise;

  try {
    const pages: Array<string> = [];

    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(pageText(content.items));
    }

    return pages.filter((page) => page.length > 0).join("\n\n");
  } finally {
    await task.destroy();
  }
};

import { Effect, Schema } from "effect";

import type { ContextFileDraft } from "@/db/repo";
import type { ContextFileKind } from "@/domain/model";
import { htmlToMarkdown } from "@/editor/markdown";
import { extractPdfText } from "@/lib/pdfText";

/** File types the context picker offers. Other text files are still accepted. */
export const CONTEXT_FILE_ACCEPT =
  ".pdf,.md,.markdown,.html,.htm,.txt,application/pdf,text/markdown,text/html,text/plain";

export class ContextImportError extends Schema.TaggedError<ContextImportError>()(
  "ContextImportError",
  {
    fileName: Schema.String,
    message: Schema.String,
  },
) {}

const KIND_BY_EXTENSION: ReadonlyMap<string, ContextFileKind> = new Map([
  ["htm", "html"],
  ["html", "html"],
  ["markdown", "markdown"],
  ["md", "markdown"],
  ["pdf", "pdf"],
  ["txt", "text"],
]);

const KIND_BY_MIME: ReadonlyMap<string, ContextFileKind> = new Map([
  ["application/pdf", "pdf"],
  ["text/html", "html"],
  ["text/markdown", "markdown"],
  ["text/plain", "text"],
]);

/**
 * Decide how to read a file. The extension wins because browsers often
 * report an empty or generic MIME type for local files. Anything unknown is
 * read as text and rejected later if it turns out to be binary.
 */
export const detectContextFileKind = (name: string, mimeType: string): ContextFileKind => {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";

  return KIND_BY_EXTENSION.get(extension) ?? KIND_BY_MIME.get(mimeType) ?? "text";
};

/** Strip the extension so the context list shows "Q3 report", not "Q3 report.pdf". */
export const contextFileDisplayName = (fileName: string): string => {
  const stem = fileName.replace(/\.[^.]+$/u, "").trim();

  return stem.length > 0 ? stem : fileName;
};

/**
 * Web pages carry navigation and footers around the article. Keep the
 * `<article>` or `<main>` element when the page has one.
 */
const htmlFileToMarkdown = (html: string): string => {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const root = parsed.querySelector("article, main") ?? parsed.body;

  return htmlToMarkdown(root.innerHTML).trim();
};

/** A NUL byte in decoded text means the file was not text to begin with. */
const rejectBinary = (fileName: string, text: string): Effect.Effect<string, ContextImportError> =>
  text.includes("\0")
    ? Effect.fail(
        new ContextImportError({
          fileName,
          message: "Not a text file. Supported: PDF, Markdown, HTML, plain text.",
        }),
      )
    : Effect.succeed(text);

const readText = (file: File): Effect.Effect<string, ContextImportError> =>
  Effect.tryPromise({
    catch: () =>
      new ContextImportError({ fileName: file.name, message: "Could not read the file." }),
    try: () => file.text(),
  }).pipe(Effect.flatMap((text) => rejectBinary(file.name, text)));

const extractByKind = (
  file: File,
  kind: ContextFileKind,
): Effect.Effect<string, ContextImportError> => {
  switch (kind) {
    case "pdf": {
      return Effect.tryPromise({
        catch: (error) =>
          new ContextImportError({
            fileName: file.name,
            message: `Could not read the PDF: ${error instanceof Error ? error.message : String(error)}`,
          }),
        try: async () => extractPdfText(await file.arrayBuffer()),
      });
    }

    case "html": {
      return readText(file).pipe(Effect.map(htmlFileToMarkdown));
    }

    case "markdown":
    case "text": {
      return readText(file);
    }
  }
};

/**
 * Turn a picked file into the text the model will see. PDF and HTML are
 * converted; Markdown and plain text are kept as written.
 */
export const importContextFile = (
  file: File,
): Effect.Effect<ContextFileDraft, ContextImportError> => {
  const kind = detectContextFileKind(file.name, file.type);

  return extractByKind(file, kind).pipe(
    Effect.flatMap((text) =>
      text.trim().length === 0
        ? Effect.fail(
            new ContextImportError({
              fileName: file.name,
              message:
                kind === "pdf"
                  ? "No text found. The PDF may be scanned images."
                  : "The file is empty.",
            }),
          )
        : Effect.succeed({ kind, name: contextFileDisplayName(file.name), text }),
    ),
  );
};

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * Maps between the plain text sent to the model and ProseMirror positions.
 *
 * The plain text is built by walking the document's text nodes in order and
 * joining block boundaries with a newline. Each segment remembers where its
 * first character sits in the ProseMirror document, so an offset into the
 * plain text can be converted back into a document position.
 */
export interface TextIndex {
  readonly text: string;
  /** Convert a plain text offset into a ProseMirror position. */
  toPos(offset: number): number;
}

interface TextSegment {
  readonly length: number;
  /** Offset of the segment's first character in the plain text. */
  readonly offset: number;
  /** ProseMirror position of the segment's first character. */
  readonly pos: number;
}

/** Plain text and position mapping for a ProseMirror document. */
export const buildTextIndex = (doc: ProseMirrorNode): TextIndex => {
  const segments: Array<TextSegment> = [];
  let text = "";
  let seenTextblock = false;

  doc.descendants((node, pos) => {
    // Every textblock (paragraph, heading, list item body...) starts a new line.
    if (node.isTextblock) {
      if (seenTextblock) {
        text += "\n";
      }

      seenTextblock = true;
    }

    if (node.isText && node.text !== undefined) {
      segments.push({ length: node.text.length, offset: text.length, pos });
      text += node.text;
    }

    return true;
  });

  const toPos = (offset: number): number => {
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index];

      if (segment !== undefined && offset >= segment.offset) {
        const within = Math.min(offset - segment.offset, segment.length);

        return segment.pos + within;
      }
    }

    return 0;
  };

  return { text, toPos };
};

export interface TextRange {
  readonly from: number;
  readonly to: number;
}

const collapseWhitespace = (value: string): string => value.replaceAll(/\s+/g, " ").trim();

/**
 * Build a regular expression that matches `quote` while tolerating any
 * whitespace run and straight/curly quote differences. Returned pattern is
 * case-insensitive when `ignoreCase` is set.
 */
const buildLooseQuotePattern = (quote: string, ignoreCase: boolean): RegExp => {
  const parts = collapseWhitespace(quote)
    .split(" ")
    .map((word) =>
      word
        .replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
        .replaceAll(/['\u2018\u2019]/g, "['\u2018\u2019]")
        .replaceAll(/["\u201C\u201D]/g, '["\u201C\u201D]'),
    );

  return new RegExp(parts.join(String.raw`\s+`), ignoreCase ? "iu" : "u");
};

/**
 * Locate `quote` in `text`, returning the plain text range of the first match
 * at or after `searchFrom`. Tries exact, then whitespace/quote tolerant, then
 * case-insensitive matching. Returns null when the quote is not present.
 */
export const locateQuote = (text: string, quote: string, searchFrom: number): TextRange | null => {
  const trimmed = quote.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const exact = text.indexOf(trimmed, searchFrom);

  if (exact !== -1) {
    return { from: exact, to: exact + trimmed.length };
  }

  for (const ignoreCase of [false, true]) {
    const pattern = buildLooseQuotePattern(trimmed, ignoreCase);
    pattern.lastIndex = 0;

    const match = pattern.exec(text.slice(searchFrom));

    if (match !== null) {
      const from = searchFrom + match.index;

      return { from, to: from + match[0].length };
    }
  }

  return null;
};

/**
 * Resolve a quote to a ProseMirror range. Searches from `searchFrom` first so
 * repeated phrases are attached in document order, and falls back to the
 * whole document when the quote only appears earlier.
 */
export const resolveQuoteRange = (
  index: TextIndex,
  quote: string,
  searchFrom: number,
): TextRange | null => {
  const located = locateQuote(index.text, quote, searchFrom) ?? locateQuote(index.text, quote, 0);

  if (located === null) {
    return null;
  }

  return { from: index.toPos(located.from), to: index.toPos(located.to) };
};

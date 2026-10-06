import { Mark, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Predicate } from "effect";

import type { PassId, SuggestionId } from "@/domain/model";
import type { TextRange } from "@/domain/textIndex";

export interface SuggestionMarkAttributes {
  readonly id: SuggestionId;
  readonly passId: PassId;
  readonly tone: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    suggestionMark: {
      /** Wrap a range in a suggestion highlight. */
      addSuggestionMark: (range: TextRange, attributes: SuggestionMarkAttributes) => ReturnType;
      /** Remove every highlight carrying this suggestion id. */
      removeSuggestionMark: (id: SuggestionId) => ReturnType;
      /** Replace the highlighted text and drop the highlight. */
      replaceSuggestionText: (id: SuggestionId, replacement: string) => ReturnType;
    };
  }
}

export const SUGGESTION_MARK_NAME = "suggestion";

/**
 * Find every range covered by the suggestion mark with `id`. Adjacent text
 * nodes sharing the mark are merged into a single range.
 */
export const findSuggestionRanges = (doc: ProseMirrorNode, id: SuggestionId): Array<TextRange> => {
  const ranges: Array<TextRange> = [];

  doc.descendants((node, pos) => {
    if (!node.isText) {
      return true;
    }

    const hasMark = node.marks.some(
      (mark) => mark.type.name === SUGGESTION_MARK_NAME && mark.attrs.id === id,
    );

    if (!hasMark) {
      return true;
    }

    const last = ranges.at(-1);

    if (last !== undefined && last.to === pos) {
      ranges[ranges.length - 1] = { from: last.from, to: pos + node.nodeSize };
    } else {
      ranges.push({ from: pos, to: pos + node.nodeSize });
    }

    return true;
  });

  return ranges;
};

/** Suggestion id of the highlight under `pos`, or null when the position is unmarked. */
export const suggestionIdAt = (doc: ProseMirrorNode, pos: number): SuggestionId | null => {
  const marks = doc.nodeAt(pos)?.marks ?? doc.resolve(pos).marks();
  const mark = marks.find((candidate) => candidate.type.name === SUGGESTION_MARK_NAME);

  if (mark === undefined || !Predicate.isString(mark.attrs.id)) {
    return null;
  }

  // SAFETY: the mark's `id` attribute is only ever written from a SuggestionId.
  return mark.attrs.id as SuggestionId;
};

/** Ids of every suggestion that still has a highlight in the document. */
export const collectSuggestionIds = (doc: ProseMirrorNode): Set<SuggestionId> => {
  const ids = new Set<SuggestionId>();

  doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type.name === SUGGESTION_MARK_NAME && Predicate.isString(mark.attrs.id)) {
        // SAFETY: the mark's `id` attribute is only ever written from a SuggestionId.
        ids.add(mark.attrs.id as SuggestionId);
      }
    }

    return true;
  });

  return ids;
};

/**
 * Inline highlight that ties a span of prose to a sidebar suggestion.
 * Marks from different passes may overlap, so this mark excludes nothing.
 */
export const SuggestionMark = Mark.create({
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-suggestion-id"),
        renderHTML: (attributes) => ({ "data-suggestion-id": attributes.id }),
      },
      passId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-pass-id"),
        renderHTML: (attributes) => ({ "data-pass-id": attributes.passId }),
      },
      tone: {
        default: 0,
        parseHTML: (element) => Number(element.getAttribute("data-tone") ?? "0"),
        renderHTML: (attributes) => ({ "data-tone": String(attributes.tone) }),
      },
    };
  },

  addCommands() {
    return {
      addSuggestionMark:
        (range, attributes) =>
        ({ dispatch, tr }) => {
          if (dispatch) {
            tr.addMark(range.from, range.to, this.type.create(attributes));
          }

          return true;
        },
      removeSuggestionMark:
        (id) =>
        ({ dispatch, state, tr }) => {
          const ranges = findSuggestionRanges(state.doc, id);

          if (ranges.length === 0) {
            return false;
          }

          if (dispatch) {
            for (const range of ranges) {
              state.doc.nodesBetween(range.from, range.to, (node) => {
                for (const mark of node.marks) {
                  if (mark.type === this.type && mark.attrs.id === id) {
                    tr.removeMark(range.from, range.to, mark);
                  }
                }
              });
            }
          }

          return true;
        },
      replaceSuggestionText:
        (id, replacement) =>
        ({ dispatch, state, tr }) => {
          const ranges = findSuggestionRanges(state.doc, id);
          const first = ranges[0];

          if (first === undefined) {
            return false;
          }

          if (dispatch) {
            const from = first.from;
            const to = ranges.at(-1)?.to ?? first.to;

            // Keep the surrounding formatting (bold, italic...) but drop the
            // suggestion highlight itself, since the note has been applied.
            const marks = state.doc
              .resolve(from)
              .marks()
              .filter((mark) => mark.type !== this.type);

            if (replacement.length === 0) {
              tr.delete(from, to);
            } else {
              tr.replaceWith(from, to, state.schema.text(replacement, marks));
            }
          }

          return true;
        },
    };
  },

  excludes: "",

  name: SUGGESTION_MARK_NAME,

  parseHTML() {
    return [{ tag: "mark[data-suggestion-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes, { class: "suggestion-mark" }), 0];
  },
});

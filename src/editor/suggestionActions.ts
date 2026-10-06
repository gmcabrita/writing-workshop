import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import type { PassId, Suggestion, SuggestionId } from "@/domain/model";
import { buildTextIndex, resolveQuoteRange, type TextRange } from "@/domain/textIndex";
import { findSuggestionRanges } from "@/editor/SuggestionMark";

/** Plain text of a document range, with block boundaries as newlines. */
export const textInRange = (editor: Editor, range: TextRange): string => {
  const index = buildTextIndex(editor.state.doc);

  return index.text.slice(index.toOffset(range.from), index.toOffset(range.to));
};

/**
 * Highlight each saved suggestion in the editor. Quotes are searched in
 * document order so a repeated phrase attaches to successive occurrences.
 * Applied as one transaction so undo removes the whole pass at once.
 * Returns how many suggestions were placed.
 */
export const applySuggestionMarks = (
  editor: Editor,
  passId: PassId,
  tone: number,
  suggestions: ReadonlyArray<Suggestion>,
  /** ProseMirror range the pass ran on; quotes are only matched inside it. */
  scope: TextRange | null = null,
): number => {
  const index = buildTextIndex(editor.state.doc);

  const window =
    scope === null ? null : { from: index.toOffset(scope.from), to: index.toOffset(scope.to) };

  let chain = editor.chain();
  let cursor = 0;
  let placed = 0;

  for (const suggestion of suggestions) {
    const range = resolveQuoteRange(index, suggestion.quote, cursor, window);

    if (range === null) {
      continue;
    }

    chain = chain.addSuggestionMark(range, { id: suggestion.id, passId, tone });
    cursor = Math.max(cursor, range.from);
    placed += 1;
  }

  chain.run();

  return placed;
};

/**
 * Attach an unplaced suggestion to the current selection. Returns false when
 * nothing is selected.
 */
export const placeSuggestionAtSelection = (
  editor: Editor,
  suggestion: Suggestion,
  tone: number,
): boolean => {
  const { from, to } = editor.state.selection;

  if (from === to) {
    return false;
  }

  editor
    .chain()
    .addSuggestionMark({ from, to }, { id: suggestion.id, passId: suggestion.passId, tone })
    .setTextSelection(to)
    .run();

  return true;
};

/** Apply the model's replacement text (or just clear the highlight). */
export const acceptSuggestionInEditor = (editor: Editor, suggestion: Suggestion): void => {
  if (suggestion.replacement === null) {
    editor.chain().removeSuggestionMark(suggestion.id).run();

    return;
  }

  editor.chain().replaceSuggestionText(suggestion.id, suggestion.replacement).run();
};

export const dismissSuggestionInEditor = (editor: Editor, id: SuggestionId): void => {
  editor.chain().removeSuggestionMark(id).run();
};

/**
 * Scroll the suggestion's highlight into view. The selection is left alone
 * so the formatting bubble does not pop up over the prose.
 */
export const revealSuggestionInEditor = (editor: Editor, id: SuggestionId): void => {
  editor.view.dom
    .querySelector(`[data-suggestion-id="${id}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
};

/**
 * Order suggestions by where their first highlight appears. Suggestions whose
 * highlight no longer exists (the text was deleted) are dropped.
 */
export const sortByDocumentOrder = (
  doc: ProseMirrorNode,
  suggestions: ReadonlyArray<Suggestion>,
): ReadonlyArray<Suggestion> => {
  const withPosition = suggestions.flatMap((suggestion) => {
    const position = findSuggestionRanges(doc, suggestion.id)[0]?.from;

    return position === undefined ? [] : [{ position, suggestion }];
  });

  withPosition.sort((a, b) => a.position - b.position);

  return withPosition.map((entry) => entry.suggestion);
};

import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import type { SuggestionDraft } from "@/db/repo";
import type { PassId, Suggestion, SuggestionId } from "@/domain/model";
import { buildTextIndex, resolveQuoteRange } from "@/domain/textIndex";
import { findSuggestionRanges } from "@/editor/SuggestionMark";

export interface AnchorResult {
  readonly anchored: ReadonlyArray<SuggestionDraft>;
  readonly unanchored: ReadonlyArray<SuggestionDraft>;
}

/**
 * Split drafts into those whose quote can be found in the document and
 * those that cannot. Pure: does not touch the editor.
 */
export const partitionAnchorable = (
  editor: Editor,
  drafts: ReadonlyArray<SuggestionDraft>,
): AnchorResult => {
  const index = buildTextIndex(editor.state.doc);
  const anchored: Array<SuggestionDraft> = [];
  const unanchored: Array<SuggestionDraft> = [];

  for (const draft of drafts) {
    if (resolveQuoteRange(index, draft.quote, 0) === null) {
      unanchored.push(draft);
    } else {
      anchored.push(draft);
    }
  }

  return { anchored, unanchored };
};

/**
 * Highlight each saved suggestion in the editor. Quotes are searched in
 * document order so a repeated phrase attaches to successive occurrences.
 * Applied as one transaction so undo removes the whole pass at once.
 */
export const applySuggestionMarks = (
  editor: Editor,
  passId: PassId,
  tone: number,
  suggestions: ReadonlyArray<Suggestion>,
): void => {
  const index = buildTextIndex(editor.state.doc);
  let chain = editor.chain();
  let cursor = 0;

  for (const suggestion of suggestions) {
    const range = resolveQuoteRange(index, suggestion.quote, cursor);

    if (range === null) {
      continue;
    }

    chain = chain.addSuggestionMark(range, { id: suggestion.id, passId, tone });
    cursor = Math.max(cursor, range.from);
  }

  chain.run();
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

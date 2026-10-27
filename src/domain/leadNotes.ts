import type { Suggestion, SuggestionDraft } from "@/domain/model";

/**
 * Models sometimes quote the lead but leave the default target. A document
 * note whose quote is absent from the document and present in the lead is
 * about the lead, so it is retargeted rather than left unplaced.
 */
export const retargetLeadDrafts = (
  drafts: ReadonlyArray<SuggestionDraft>,
  documentText: string,
  lead: string,
): ReadonlyArray<SuggestionDraft> =>
  drafts.map((draft) =>
    draft.target === "document" &&
    draft.quote.length > 0 &&
    !documentText.includes(draft.quote) &&
    lead.includes(draft.quote)
      ? { ...draft, target: "lead" }
      : draft,
  );

/**
 * Apply a lead note's replacement to the lead text. The lead is a plain
 * string, so the quote is matched literally; when it is no longer there
 * (the writer edited the lead) the text is returned unchanged.
 */
export const applyLeadReplacement = (lead: string, suggestion: Suggestion): string => {
  if (suggestion.replacement === null) {
    return lead;
  }

  const at = lead.indexOf(suggestion.quote);

  return at === -1
    ? lead
    : lead.slice(0, at) + suggestion.replacement + lead.slice(at + suggestion.quote.length);
};

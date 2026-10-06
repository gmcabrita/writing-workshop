import type { JSONContent } from "@tiptap/core";

/** Stable ids are UUID strings. Branded aliases keep them from being mixed up. */
export type DocumentId = string & { readonly __brand: "DocumentId" };

export type RevisionId = string & { readonly __brand: "RevisionId" };

export type PassId = string & { readonly __brand: "PassId" };

export type SuggestionId = string & { readonly __brand: "SuggestionId" };

export type PassPromptId = string & { readonly __brand: "PassPromptId" };

// SAFETY: a fresh UUID is a valid DocumentId; the brand only prevents mixing id kinds.
export const newDocumentId = (): DocumentId => crypto.randomUUID() as DocumentId;

// SAFETY: a fresh UUID is a valid RevisionId; the brand only prevents mixing id kinds.
export const newRevisionId = (): RevisionId => crypto.randomUUID() as RevisionId;

// SAFETY: a fresh UUID is a valid PassId; the brand only prevents mixing id kinds.
export const newPassId = (): PassId => crypto.randomUUID() as PassId;

// SAFETY: a fresh UUID is a valid SuggestionId; the brand only prevents mixing id kinds.
export const newSuggestionId = (): SuggestionId => crypto.randomUUID() as SuggestionId;

// SAFETY: a fresh UUID is a valid PassPromptId; the brand only prevents mixing id kinds.
export const newPassPromptId = (): PassPromptId => crypto.randomUUID() as PassPromptId;

/** Id of the synthetic pass that holds annotations the writer adds by hand. */
// SAFETY: "manual" is reserved and never produced by newPassId (UUIDs contain dashes).
export const MANUAL_PASS_ID = "manual" as PassId;

/** Working copy of a document. `content` is the live TipTap document. */
export interface WorkshopDocument {
  readonly content: JSONContent;
  readonly createdAt: number;
  readonly id: DocumentId;
  readonly title: string;
  readonly updatedAt: number;
}

/** Point-in-time snapshot of a document. The writer may flag it as major. */
export interface Revision {
  readonly content: JSONContent;
  readonly createdAt: number;
  readonly documentId: DocumentId;
  readonly id: RevisionId;
  readonly label: string;
  readonly major: boolean;
}

export type PassStatus = "running" | "done" | "error";

/**
 * One workshopping run over a document. A pass owns a set of suggestions
 * and a tone (palette index) so its highlights share a colour.
 */
export interface Pass {
  readonly createdAt: number;
  readonly documentId: DocumentId;
  readonly error: string | null;
  readonly id: PassId;
  readonly promptName: string;
  readonly status: PassStatus;
  readonly tone: number;
}

export type SuggestionStatus = "open" | "accepted" | "dismissed";

/**
 * Commentary attached to a span of the document. The span itself lives in
 * the editor as a mark carrying this suggestion's id, so it follows edits.
 */
export interface Suggestion {
  readonly comment: string;
  readonly createdAt: number;
  readonly documentId: DocumentId;
  readonly id: SuggestionId;
  readonly order: number;
  readonly passId: PassId;
  readonly quote: string;
  readonly replacement: string | null;
  readonly status: SuggestionStatus;
}

/** A named, pass-specific prompt the writer can pick when running a pass. */
export interface PassPrompt {
  readonly id: PassPromptId;
  readonly name: string;
  readonly order: number;
  readonly prompt: string;
}

/** Connection details for an OpenAI-compatible chat completions endpoint. */
export interface LlmConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly jsonMode: boolean;
  readonly model: string;
  readonly temperature: number;
}

export interface Settings {
  readonly id: "settings";
  readonly llm: LlmConfig;
  readonly systemPrompt: string;
}

export const DEFAULT_SYSTEM_PROMPT = `Workshop a piece with me. NO ENCOURAGEMENT. Encouragement is useless; the only useful things are suggested corrections.
DO NOT WRITE COPY FOR ME. Any words you provide will be disqualified, so if you come up with good words, I’m fucked because I can’t use
them.
Tell me ABOUT what should change. Assume I know my audience extremely well. We’re going to do this in a series of passes. Keep your suggestions locked in to the current pass we’re on. Note typos, but DO NOT generate long structural critiques based on those typos; note them and move on, assuming that I meant to write properly.`;

/**
 * Output contract the app needs to anchor notes to the text. Appended to
 * every request after the writer's system prompt; not editable in settings
 * so the parser and the instructions cannot drift apart.
 */
export const RESPONSE_FORMAT_INSTRUCTIONS = `Respond with JSON only, in this exact form:
{"suggestions":[{"quote":"exact text copied from the document","comment":"what should change and why","replacement":null}]}

"quote": copy it verbatim from the document, character for character, including punctuation. Keep each quote short (a phrase or a sentence). Never paraphrase it.
"comment": describe the problem and the kind of change needed. Do not supply rewritten wording.
"replacement": null. Use a string only for a mechanical typo fix (spelling, doubled word, punctuation).`;

/**
 * Default passes follow Joseph M. Williams, "Style: Lessons in Clarity and
 * Grace", in the order the book recommends: fix large problems before small
 * ones. Each prompt names the diagnostic test so notes point at evidence.
 */
export const DEFAULT_PASS_PROMPTS: ReadonlyArray<Omit<PassPrompt, "id">> = [
  {
    name: "Motivation",
    order: 0,
    prompt: `Motivation pass (Williams, Lesson 7). Look only at the introduction and, briefly, the conclusion.
Test: can a reader draw a line where the introduction ends? Before that line, find (a) shared context the reader already accepts, (b) the problem as a condition plus its cost to these readers, and (c) the main point, normally in the last sentence or two. Decide whether the problem is practical (a condition that costs someone something) or conceptual (something not yet understood, and what that blocks).
Report what is missing or out of order: a cost that is only implied, a point that never arrives or arrives before the problem, context that disturbs nothing. Quote the sentence where the reader would first ask "so what?". For the conclusion, say whether it restates the point, adds its significance, and names what remains. Ignore sentence-level style.`,
  },
  {
    name: "Global coherence",
    order: 1,
    prompt: `Global coherence pass (Williams, Lesson 8). Work at the level of sections and paragraphs.
Test: for each section and paragraph, draw a line after its issue (the opening sentence or two). Does the issue state the point of that unit? Do the key terms from the main point reappear in each issue? Is the order of sections signalled and logical (chronological, general to specific, familiar to unfamiliar, less to more important)?
Quote the opening phrase of each unit whose issue fails the test, and say what the unit is actually about by the time it ends. Flag a point that is held to the end of the document without an announced reason. Name the theme words the main point promises and list where they drop out. Do not comment on wording inside sentences.`,
  },
  {
    name: "Cohesion",
    order: 2,
    prompt: `Cohesion pass (Williams, Lesson 5). Work paragraph by paragraph.
Test: read the first six or seven words of every sentence in a paragraph. Do they name a small set of related characters or concepts, and are those what the reader would call the paragraph's subject? Does each sentence open with information the previous sentence or common knowledge has already given, and close with what is new?
Where topics jump, quote the opening words of the offending sentences in order so the string is visible, then say which character the paragraph should keep as its topic. Flag new information that arrives at the start of a sentence, and synonyms used for the same thing where expository prose needs one term. A passive that keeps the topic consistent is correct; do not flag it here.`,
  },
  {
    name: "Characters and actions",
    order: 3,
    prompt: `Characters and actions pass (Williams, Lessons 3 and 4). Sentence level.
Test: in each sentence, mark the simple subject. Is it a short, specific character (person, group, concrete thing that acts)? Find the actions. Are they verbs, or nominalizations and adjectives (decision, failure, implementation, applicability)? Look for the patterns: nominalization as subject of an empty verb, nominalization after an empty verb, nominalization after "there is", two nominalizations in a row or joined by a preposition, a character hidden in a by-phrase or possessive, noun strings of three or more nouns.
For each flagged sentence, name the real character and the real action and say where each is hiding. Do not flag nominalizations that refer back to the previous sentence, name a familiar concept the reader knows as a noun, or replace a clause the reader does not need. Do not flag a passive unless it hides a character the reader needs or breaks old-before-new.`,
  },
  {
    name: "Emphasis",
    order: 4,
    prompt: `Emphasis pass (Williams, Lesson 6). Sentence level.
Test: read the last three or four words of each sentence. Are they the words that deserve stress: the new, important, or complex information? Or trailing filler (in this area, at the present time, for the most part) and peripheral qualifications? Is a technical term introduced for the first time placed at the end of its sentence?
Quote the closing words that waste the stress position and name the phrase earlier in the sentence that should have ended it. Flag sentences whose complex element comes before the subject and verb instead of after. Note heavy, long phrases before short ones in a coordinated pair. Leave concision and grammar to other passes.`,
  },
  {
    name: "Concision",
    order: 5,
    prompt: `Concision pass (Williams, Lesson 9). Cut words that do no work for the reader.
Look for: meaningless modifiers (kind of, actually, really, basically, generally, certain, various, virtually, specific, particular); redundant pairs (full and complete, each and every); redundant modifiers and categories (completely finish, period of time, large in size); phrases standing in for a word (due to the fact that, in the event that, at this point in time, has the ability to); negatives that could be a positive word (not many, did not remember); metadiscourse that narrates thinking rather than orienting the reader (it is important to note that, I will argue); hedges spread over every claim; intensifiers (very, clearly, obviously, crucial).
Quote the span and name the category. Keep hedges that state honest uncertainty and metadiscourse that maps a long document; say so when a borderline case should stay. Do not cut toward terse or rude.`,
  },
  {
    name: "Shape",
    order: 6,
    prompt: `Shape pass (Williams, Lesson 10). Long sentences only.
Test: how many words before the reader reaches the subject? How long is the subject itself? Is anything interrupting subject and verb, or verb and object? After the verb, do clauses sprawl without structure? Does sentence length vary, or do short choppy sentences hide the logic between them?
Quote the long introductory phrase, the long subject, or the interruption, and say which it is. For sprawl, say whether the fix is to break the sentence or to reshape its tail with a resumptive modifier (repeat a key word and continue), a summative modifier (sum the clause in a noun and continue), or a free modifier (a closing phrase about the subject). Point out coordinated elements where the longer one comes first.`,
  },
  {
    name: "Elegance",
    order: 7,
    prompt: `Elegance pass (Williams, Lesson 11). Run only when the piece is already clear and coherent; if it is not, say so in one note and stop.
Look at key claims, openings, and closings. Are coordinated elements grammatically parallel? Do lists and pairs build short to long, less to more important, and end on the strongest element? Is a metaphor precise, or tired or mixed? Read for rhythm: does the stress fall on the words that matter?
Quote the span. Name the figure that is broken (balance, climax, parallelism) or the effect that is lost. Flag ornament that calls attention to itself in expository stretches. Leave everything else alone.`,
  },
  {
    name: "Correctness and ethics",
    order: 8,
    prompt: `Correctness and ethics pass (Williams, Lessons 2 and 12).
Correctness: flag real errors only: agreement, dangling modifiers that mislead, pronoun case, fragments that confuse, typos, doubled words, punctuation that changes meaning. Note each typo in a few words and move on; do not build an argument on it. Do not enforce folklore: sentence-initial and/but/so/because, split infinitives, prepositions at the end, which for restrictive clauses, first person, singular none.
Ethics: flag passives and nominalizations that hide who did something where the reader needs to know; jargon that impresses rather than informs; hedges that dodge a claim the writer plainly holds; euphemism for bad news; complexity dressed over a simple idea. Quote the span and say what the reader cannot see.`,
  },
];

export const DEFAULT_SETTINGS: Settings = {
  id: "settings",
  llm: {
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    jsonMode: true,
    model: "gpt-4o-mini",
    temperature: 0.4,
  },
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

export const EMPTY_DOCUMENT_CONTENT: JSONContent = {
  content: [{ type: "paragraph" }],
  type: "doc",
};

/** Number of distinct highlight colours available to passes. */
export const TONE_COUNT = 6;

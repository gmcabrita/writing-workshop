import { Context, Effect, Layer, Schema } from "effect";

import {
  type ContextFile,
  type LlmConfig,
  type PriorNote,
  RESPONSE_FORMAT_INSTRUCTIONS,
  type SuggestionDraft,
  type SuggestionTarget,
} from "@/domain/model";
import { type ChatMessage, LlmClient, type LlmError } from "@/llm/LlmClient";

export class WorkshopParseError extends Schema.TaggedError<WorkshopParseError>()(
  "WorkshopParseError",
  {
    message: Schema.String,
    raw: Schema.String,
  },
) {}

/** What the model is asked to return. Lenient on optional fields. */
const ModelSuggestion = Schema.Struct({
  comment: Schema.String,
  quote: Schema.String,
  replacement: Schema.optional(Schema.NullOr(Schema.String)),
});

const decodeEnvelope = Schema.decodeUnknownEffect(
  Schema.Struct({ suggestions: Schema.Array(ModelSuggestion) }),
);

/** Some models return a bare array instead of the requested envelope. */
const decodeBareArray = Schema.decodeUnknownEffect(Schema.Array(ModelSuggestion));

/**
 * Models often wrap JSON in a markdown fence or add a sentence before it.
 * Extract the outermost JSON object or array from the text.
 */
const extractJson = (raw: string): string => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(raw);
  const candidate = fenced?.[1] ?? raw;
  const firstBrace = candidate.search(/[[{]/u);
  const lastBrace = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return candidate.trim();
  }

  return candidate.slice(firstBrace, lastBrace + 1);
};

/** `subject` becomes the target of every parsed note. */
export const parseSuggestions = (
  raw: string,
  subject: SuggestionTarget,
): Effect.Effect<ReadonlyArray<SuggestionDraft>, WorkshopParseError> =>
  Effect.try({
    catch: () => new WorkshopParseError({ message: "Model did not return JSON.", raw }),
    try: () => JSON.parse(extractJson(raw)),
  }).pipe(
    Effect.flatMap((json) =>
      decodeEnvelope(json).pipe(
        Effect.map((envelope): ReadonlyArray<typeof ModelSuggestion.Type> => envelope.suggestions),
        Effect.catch(() => decodeBareArray(json)),
        Effect.mapError(
          (error) =>
            new WorkshopParseError({ message: `Unexpected response: ${error.message}`, raw }),
        ),
      ),
    ),
    Effect.map((items) =>
      items.map((item): SuggestionDraft => ({
        comment: item.comment.trim(),
        quote: item.quote,
        replacement: item.replacement ?? null,
        target: subject,
      })),
    ),
  );

/** Cap on prior notes sent, newest first, to bound prompt size. */
export const MAX_PRIOR_NOTES = 40;

export interface PassRequest {
  readonly config: LlmConfig;
  /** Reference material the writer attached to the document. */
  readonly contextFiles: ReadonlyArray<ContextFile>;
  readonly documentText: string;
  /** True when `documentText` is a selection from a longer piece. */
  readonly excerpt: boolean;
  /** Summary or hook shown outside the piece. Empty when there is none. */
  readonly lead: string;
  readonly passPrompt: string;
  /** Notes from earlier passes on this document, newest first. */
  readonly priorNotes: ReadonlyArray<PriorNote>;
  /**
   * What the notes are about. A document pass sends the lead as context
   * only; a lead pass sends the document as context and asks for notes on
   * the lead alone. The runner sends both for a whole-document pass.
   */
  readonly subject: SuggestionTarget;
  readonly systemPrompt: string;
}

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const STATUS_NOTE: Record<PriorNote["status"], string> = {
  accepted: "accepted and applied",
  dismissed: "declined by the writer; do not raise again",
  open: "still open",
};

/**
 * Earlier notes let the model skip what is already covered. Omitted when
 * there is nothing to report.
 */
const priorNotesSection = (notes: ReadonlyArray<PriorNote>): string => {
  if (notes.length === 0) {
    return "";
  }

  const lines = notes
    .slice(0, MAX_PRIOR_NOTES)
    .map(
      (note) =>
        `- [${STATUS_NOTE[note.status]}] "${truncate(note.quote, 80)}": ${truncate(note.comment, 160)}`,
    );

  return `\n\n## Earlier notes on this document\n\nDo not repeat these. Declined notes mean the writer disagrees; drop the point.\n\n${lines.join("\n")}`;
};

/**
 * On a document pass the lead is context: the promise the document must
 * keep. Omitted for excerpts and when there is no lead.
 */
const leadContextSection = (request: PassRequest): string =>
  request.excerpt || request.lead.trim().length === 0
    ? ""
    : `## Lead\n\nShown outside the piece, before the title, as its summary or hook. It is reviewed in a separate request: do not comment on the lead here, and do not attach notes about it to document sentences. Use it only to judge whether the document delivers what it promises.\n\n${request.lead.trim()}\n\n`;

/**
 * Reference material (reports, notes, sources) is sent in full. It is
 * background for judging the document, never a target for notes.
 */
const contextFilesSection = (files: ReadonlyArray<ContextFile>): string => {
  if (files.length === 0) {
    return "";
  }

  const blocks = files.map((file) => `### ${file.name}\n\n${file.text.trim()}`);

  return `## Reference material\n\nBackground the writer supplied. Use it to check facts, figures, and emphasis. Do not quote from it; quotes must come from the document.\n\n${blocks.join("\n\n")}\n\n`;
};

const documentSection = (request: PassRequest): string =>
  request.excerpt
    ? `## Excerpt\n\nThe writer selected this excerpt from a longer piece. Comment only on the excerpt; do not assume what surrounds it.\n\n${request.documentText}`
    : `## Document\n\n${request.documentText}`;

/**
 * A lead pass inverts the roles: the document is context and the lead is
 * the text under review. Every quote must come from the lead.
 */
const leadSubjectBody = (request: PassRequest): string =>
  `## Editing pass\n\n${request.passPrompt}\n\n` +
  contextFilesSection(request.contextFiles) +
  `## Document (context only)\n\nThe piece the lead introduces. Do not comment on it or quote from it here.\n\n${request.documentText}\n\n` +
  `## Lead (the text to workshop)\n\nShown outside the piece, before the title, as its summary or hook. Apply the pass to the lead as a complete text of its own: it must stand alone and keep the promise the document makes. Every quote must be copied verbatim from the lead. Return an empty list if the pass does not apply.\n\n${request.lead.trim()}`;

const documentSubjectBody = (request: PassRequest): string =>
  `## Editing pass\n\n${request.passPrompt}\n\n` +
  contextFilesSection(request.contextFiles) +
  leadContextSection(request) +
  documentSection(request);

export const buildMessages = (request: PassRequest): ReadonlyArray<ChatMessage> => [
  { content: `${request.systemPrompt.trim()}\n\n${RESPONSE_FORMAT_INSTRUCTIONS}`, role: "system" },
  {
    content:
      (request.subject === "lead" ? leadSubjectBody(request) : documentSubjectBody(request)) +
      priorNotesSection(request.priorNotes),
    role: "user",
  },
];

/** Runs one editing pass: prompt the model, parse its notes into drafts. */
export class Workshop extends Context.Service<
  Workshop,
  {
    runPass(
      request: PassRequest,
    ): Effect.Effect<ReadonlyArray<SuggestionDraft>, LlmError | WorkshopParseError>;
  }
>()("writing-workshop/llm/Workshop") {
  static readonly layer = Layer.effect(
    Workshop,
    Effect.gen(function* () {
      const llm = yield* LlmClient;

      const runPass = Effect.fn("Workshop.runPass")(function* (request: PassRequest) {
        const raw = yield* llm.complete(request.config, buildMessages(request));

        // The raw reply is not stored. Log it so a pass that returns fewer
        // notes than expected can be checked in the browser console.
        // oxlint-disable-next-line no-console
        console.debug("[workshop] model reply", raw);

        return yield* parseSuggestions(raw, request.subject);
      });

      return Workshop.of({ runPass });
    }),
  ).pipe(Layer.provide(LlmClient.layer));
}

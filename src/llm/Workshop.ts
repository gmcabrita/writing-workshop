import { Context, Effect, Layer, Schema } from "effect";

import type { SuggestionDraft } from "@/db/repo";
import { type LlmConfig, type PriorNote, RESPONSE_FORMAT_INSTRUCTIONS } from "@/domain/model";
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

export const parseSuggestions = (
  raw: string,
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
      })),
    ),
  );

/** Cap on prior notes sent, newest first, to bound prompt size. */
export const MAX_PRIOR_NOTES = 40;

export interface PassRequest {
  readonly config: LlmConfig;
  readonly documentText: string;
  /** True when `documentText` is a selection from a longer piece. */
  readonly excerpt: boolean;
  readonly passPrompt: string;
  /** Notes from earlier passes on this document, newest first. */
  readonly priorNotes: ReadonlyArray<PriorNote>;
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

export const buildMessages = (request: PassRequest): ReadonlyArray<ChatMessage> => [
  { content: `${request.systemPrompt.trim()}\n\n${RESPONSE_FORMAT_INSTRUCTIONS}`, role: "system" },
  {
    content:
      (request.excerpt
        ? `## Editing pass\n\n${request.passPrompt}\n\n## Excerpt\n\nThe writer selected this excerpt from a longer piece. Comment only on the excerpt; do not assume what surrounds it.\n\n${request.documentText}`
        : `## Editing pass\n\n${request.passPrompt}\n\n## Document\n\n${request.documentText}`) +
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

        return yield* parseSuggestions(raw);
      });

      return Workshop.of({ runPass });
    }),
  ).pipe(Layer.provide(LlmClient.layer));
}

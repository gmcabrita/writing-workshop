import { Context, Effect, Layer, Schema } from "effect";

import type { SuggestionDraft } from "@/db/repo";
import { type LlmConfig, RESPONSE_FORMAT_INSTRUCTIONS } from "@/domain/model";
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

export interface PassRequest {
  readonly config: LlmConfig;
  readonly documentText: string;
  readonly passPrompt: string;
  readonly systemPrompt: string;
}

export const buildMessages = (request: PassRequest): ReadonlyArray<ChatMessage> => [
  { content: `${request.systemPrompt.trim()}\n\n${RESPONSE_FORMAT_INSTRUCTIONS}`, role: "system" },
  {
    content: `## Editing pass\n\n${request.passPrompt}\n\n## Document\n\n${request.documentText}`,
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

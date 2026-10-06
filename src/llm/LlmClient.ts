import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import type { LlmConfig } from "@/domain/model";

export class LlmError extends Schema.TaggedError<LlmError>()("LlmError", {
  message: Schema.String,
}) {}

export interface ChatMessage {
  readonly content: string;
  readonly role: "system" | "user";
}

/** Shape of a chat completions response. Only the first choice's text is used. */
const ChatCompletionResponse = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({
        content: Schema.NullOr(Schema.String),
      }),
    }),
  ),
});

const decodeChatCompletion = Schema.decodeUnknownEffect(ChatCompletionResponse);

/** Error body many OpenAI-compatible servers return. Used to surface a readable message. */
const ErrorBody = Schema.Struct({
  error: Schema.Struct({ message: Schema.String }),
});

const decodeErrorBody = Schema.decodeUnknownEffect(ErrorBody);

const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

interface ChatCompletionRequestBody {
  messages: ReadonlyArray<ChatMessage>;
  model: string;
  /** Asks servers that support it to return strict JSON. Omitted otherwise. */
  response_format?: { type: "json_object" };
  temperature: number;
}

/**
 * Minimal OpenAI-compatible chat completions client. The endpoint is passed
 * per call because the writer can change it at any time in settings.
 */
export class LlmClient extends Context.Service<
  LlmClient,
  {
    complete(
      config: LlmConfig,
      messages: ReadonlyArray<ChatMessage>,
    ): Effect.Effect<string, LlmError>;
  }
>()("writing-workshop/llm/LlmClient") {
  static readonly layer = Layer.effect(
    LlmClient,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;

      const complete = Effect.fn("LlmClient.complete")(function* (
        config: LlmConfig,
        messages: ReadonlyArray<ChatMessage>,
      ) {
        const body: ChatCompletionRequestBody = {
          messages,
          model: config.model,
          temperature: config.temperature,
        };

        if (config.jsonMode) {
          body.response_format = { type: "json_object" };
        }

        let request = HttpClientRequest.post(
          `${trimTrailingSlash(config.baseUrl)}/chat/completions`,
        ).pipe(HttpClientRequest.bodyJsonUnsafe(body), HttpClientRequest.acceptJson);

        if (config.apiKey.length > 0) {
          request = HttpClientRequest.bearerToken(request, config.apiKey);
        }

        const response = yield* http
          .execute(request)
          .pipe(
            Effect.mapError(
              (error) => new LlmError({ message: `Request failed: ${error.message}` }),
            ),
          );

        const text = yield* response.text.pipe(
          Effect.mapError(
            (error) => new LlmError({ message: `Could not read response: ${error.message}` }),
          ),
        );

        if (response.status < 200 || response.status >= 300) {
          const detail = yield* Effect.try(() => JSON.parse(text)).pipe(
            Effect.flatMap(decodeErrorBody),
            Effect.map((parsed) => parsed.error.message),
            Effect.catch(() => Effect.succeed(text.slice(0, 300))),
          );

          return yield* new LlmError({ message: `HTTP ${response.status}: ${detail}` });
        }

        const parsed = yield* Effect.try(() => JSON.parse(text)).pipe(
          Effect.flatMap(decodeChatCompletion),
          Effect.mapError(
            () => new LlmError({ message: "Response was not a chat completion object." }),
          ),
        );

        const content = parsed.choices[0]?.message.content;

        if (content === undefined || content === null) {
          return yield* new LlmError({ message: "Response contained no message content." });
        }

        return content;
      });

      return LlmClient.of({ complete });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}

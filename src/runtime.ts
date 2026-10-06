import { Layer, ManagedRuntime } from "effect";

import { LlmClient } from "@/llm/LlmClient";
import { Workshop } from "@/llm/Workshop";

/**
 * Single Effect runtime for the whole app. React code calls `runtime.runPromise`.
 * LlmClient is exposed alongside Workshop so settings can test a connection.
 */
export const runtime = ManagedRuntime.make(Layer.mergeAll(Workshop.layer, LlmClient.layer));

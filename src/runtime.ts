import { ManagedRuntime } from "effect";

import { Workshop } from "@/llm/Workshop";

/** Single Effect runtime for the whole app. React code calls `runtime.runPromise`. */
export const runtime = ManagedRuntime.make(Workshop.layer);

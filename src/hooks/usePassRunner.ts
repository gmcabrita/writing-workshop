import type { Editor } from "@tiptap/core";
import { Effect } from "effect";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { addSuggestions, createPass, deletePass, finishPass } from "@/db/repo";
import type { DocumentId, PassId, PassPrompt, Settings } from "@/domain/model";
import { buildTextIndex } from "@/domain/textIndex";
import { applySuggestionMarks } from "@/editor/suggestionActions";
import { Workshop } from "@/llm/Workshop";
import { runtime } from "@/runtime";

export interface RunningPass {
  readonly passId: PassId;
  readonly promptName: string;
}

export interface PassRunner {
  cancel(): void;
  run(prompt: PassPrompt): Promise<void>;
  readonly running: RunningPass | null;
}

/**
 * Drives one LLM pass end to end: create the pass record, call the model,
 * anchor its notes to the prose, persist them, and report the outcome.
 */
export const usePassRunner = (
  editor: Editor | null,
  documentId: DocumentId | null,
  settings: Settings,
): PassRunner => {
  const [running, setRunning] = useState<RunningPass | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (prompt: PassPrompt) => {
      if (editor === null || documentId === null || running !== null) {
        return;
      }

      if (settings.llm.model.trim().length === 0 || settings.llm.baseUrl.trim().length === 0) {
        toast.error("Set a base URL and model in Settings first.");

        return;
      }

      const pass = await createPass(documentId, prompt.name);
      const abort = new AbortController();
      abortRef.current = abort;
      setRunning({ passId: pass.id, promptName: prompt.name });

      const program = Effect.gen(function* () {
        const workshop = yield* Workshop;

        const drafts = yield* workshop.runPass({
          config: settings.llm,
          documentText: buildTextIndex(editor.state.doc).text,
          passPrompt: prompt.prompt,
          systemPrompt: settings.systemPrompt,
        });

        // Every note is kept. Those whose quote cannot be found get no
        // highlight and appear in the margin as unplaced.
        const saved = yield* Effect.promise(() => addSuggestions(documentId, pass.id, drafts));

        const placed = yield* Effect.sync(() =>
          applySuggestionMarks(editor, pass.id, pass.tone, saved),
        );

        yield* Effect.promise(() => finishPass(pass.id, "done", null));

        return { placed, unplaced: saved.length - placed };
      }).pipe(
        Effect.tap((outcome) =>
          Effect.sync(() => {
            const unplaced =
              outcome.unplaced > 0 ? ` ${outcome.unplaced} unplaced (quote not found).` : "";

            toast.success(`${prompt.name}: ${outcome.placed} notes.${unplaced}`);
          }),
        ),
        Effect.catch((error) =>
          Effect.promise(() => finishPass(pass.id, "error", error.message)).pipe(
            Effect.tap(() =>
              Effect.sync(() => toast.error(`${prompt.name} failed: ${error.message}`)),
            ),
          ),
        ),
      );

      try {
        await runtime.runPromise(program, { signal: abort.signal });
      } catch {
        // Only interruption reaches here; typed failures are handled above.
        await deletePass(pass.id);
        toast.message(`${prompt.name} cancelled.`);
      } finally {
        abortRef.current = null;
        setRunning(null);
      }
    },
    [documentId, editor, running, settings],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { cancel, run, running };
};

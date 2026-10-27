import type { Editor } from "@tiptap/core";
import { Effect } from "effect";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import {
  addSuggestions,
  createPass,
  createRevision,
  deletePass,
  finishPass,
  loadContextFiles,
  loadPriorNotes,
} from "@/db/repo";
import { retargetLeadDrafts } from "@/domain/leadNotes";
import type { DocumentId, PassId, PassPrompt, Settings, SuggestionDraft } from "@/domain/model";
import { buildTextIndex, type TextRange } from "@/domain/textIndex";
import { applySuggestionMarks, textInRange } from "@/editor/suggestionActions";
import { Workshop } from "@/llm/Workshop";
import { runtime } from "@/runtime";

const NO_DRAFTS: ReadonlyArray<SuggestionDraft> = [];

export interface RunningPass {
  readonly passId: PassId;
  readonly promptName: string;
}

export interface PassRunner {
  cancel(): void;
  /** `scope` limits the pass to a document range (the writer's selection). */
  run(prompt: PassPrompt, scope: TextRange | null): Promise<void>;
  readonly running: RunningPass | null;
}

/**
 * Drives one LLM pass end to end: create the pass record, call the model,
 * anchor its notes to the prose, persist them, and report the outcome.
 * `lead` is the document's current lead text, sent as context.
 */
export const usePassRunner = (
  editor: Editor | null,
  documentId: DocumentId | null,
  lead: string,
  settings: Settings,
): PassRunner => {
  const [running, setRunning] = useState<RunningPass | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (prompt: PassPrompt, scope: TextRange | null) => {
      if (editor === null || documentId === null || running !== null) {
        return;
      }

      if (settings.llm.model.trim().length === 0 || settings.llm.baseUrl.trim().length === 0) {
        toast.error("Set a base URL and model in Settings first.");

        return;
      }

      // A pass is a natural revision boundary: snapshot the text the model saw.
      await createRevision(documentId, editor.getJSON(), `Before ${prompt.name} pass`, false);

      const pass = await createPass(documentId, prompt.name);
      const abort = new AbortController();
      abortRef.current = abort;
      setRunning({ passId: pass.id, promptName: prompt.name });

      const program = Effect.gen(function* () {
        const workshop = yield* Workshop;

        const [priorNotes, contextFiles] = yield* Effect.promise(() =>
          Promise.all([loadPriorNotes(documentId), loadContextFiles(documentId)]),
        );

        const documentText =
          scope === null ? buildTextIndex(editor.state.doc).text : textInRange(editor, scope);

        const base = {
          config: settings.llm,
          contextFiles,
          documentText,
          excerpt: scope !== null,
          lead,
          passPrompt: prompt.prompt,
          priorNotes,
          systemPrompt: settings.systemPrompt,
        };

        // A whole-document pass with a lead is two requests, run together:
        // one on the document, one on the lead alone. The lead request is
        // separate so the model gives it full attention and so every note
        // it returns is known to be about the lead.
        const workshopLead = scope === null && lead.trim().length > 0;

        const [documentDrafts, leadDrafts] = yield* Effect.all(
          [
            workshop.runPass({ ...base, subject: "document" }),
            workshopLead
              ? workshop.runPass({ ...base, subject: "lead" })
              : Effect.succeed(NO_DRAFTS),
          ],
          { concurrency: 2 },
        );

        // Lead quotes in the document reply would otherwise be unplaced.
        const drafts = [
          ...leadDrafts,
          ...(scope === null
            ? retargetLeadDrafts(documentDrafts, documentText, lead)
            : documentDrafts),
        ];

        // Every note is kept. Document notes whose quote cannot be found get
        // no highlight and appear in the margin as unplaced. Lead notes
        // never get a highlight; they sit beside the lead field.
        const saved = yield* Effect.promise(() => addSuggestions(documentId, pass.id, drafts));
        const documentNotes = saved.filter((note) => note.target === "document");

        const placed = yield* Effect.sync(() =>
          applySuggestionMarks(editor, pass.id, pass.tone, documentNotes, scope),
        );

        yield* Effect.promise(() => finishPass(pass.id, "done", null));

        return {
          lead: saved.length - documentNotes.length,
          placed,
          unplaced: documentNotes.length - placed,
        };
      }).pipe(
        Effect.tap((outcome) =>
          Effect.sync(() => {
            const lead = outcome.lead > 0 ? ` ${outcome.lead} on the lead.` : "";

            const unplaced =
              outcome.unplaced > 0 ? ` ${outcome.unplaced} unplaced (quote not found).` : "";

            toast.success(`${prompt.name}: ${outcome.placed} notes.${lead}${unplaced}`);
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
    [documentId, editor, lead, running, settings],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { cancel, run, running };
};

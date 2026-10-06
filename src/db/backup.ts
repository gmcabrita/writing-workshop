import type { JSONContent } from "@tiptap/core";
import { Effect, Schema } from "effect";

import { db } from "@/db/database";
import type {
  DocumentId,
  Pass,
  PassId,
  PassPrompt,
  PassPromptId,
  Revision,
  RevisionId,
  Settings,
  Suggestion,
  SuggestionId,
  WorkshopDocument,
} from "@/domain/model";

/**
 * Whole-workspace backup. The API key is left out: the file is meant to be
 * moved between machines and the key is cheap to re-enter.
 */
export const BACKUP_VERSION = 1;

export class BackupParseError extends Schema.TaggedError<BackupParseError>()("BackupParseError", {
  message: Schema.String,
}) {}

const DocumentSchema = Schema.Struct({
  content: Schema.Json,
  createdAt: Schema.Number,
  id: Schema.String,
  title: Schema.String,
  updatedAt: Schema.Number,
});

const RevisionSchema = Schema.Struct({
  content: Schema.Json,
  createdAt: Schema.Number,
  documentId: Schema.String,
  id: Schema.String,
  label: Schema.String,
  major: Schema.Boolean,
});

const PassSchema = Schema.Struct({
  createdAt: Schema.Number,
  documentId: Schema.String,
  error: Schema.NullOr(Schema.String),
  // Added after the first release; older backups omit it.
  hidden: Schema.optional(Schema.Boolean),
  id: Schema.String,
  promptName: Schema.String,
  status: Schema.Literals(["running", "done", "error"]),
  tone: Schema.Number,
});

const SuggestionSchema = Schema.Struct({
  comment: Schema.String,
  createdAt: Schema.Number,
  documentId: Schema.String,
  id: Schema.String,
  order: Schema.Number,
  passId: Schema.String,
  quote: Schema.String,
  replacement: Schema.NullOr(Schema.String),
  status: Schema.Literals(["open", "accepted", "dismissed"]),
});

const PassPromptSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  order: Schema.Number,
  prompt: Schema.String,
});

const SettingsSchema = Schema.Struct({
  id: Schema.Literal("settings"),
  llm: Schema.Struct({
    apiKey: Schema.String,
    baseUrl: Schema.String,
    jsonMode: Schema.Boolean,
    model: Schema.String,
    temperature: Schema.Number,
  }),
  systemPrompt: Schema.String,
});

const BackupSchema = Schema.Struct({
  documents: Schema.Array(DocumentSchema),
  exportedAt: Schema.Number,
  passes: Schema.Array(PassSchema),
  passPrompts: Schema.Array(PassPromptSchema),
  revisions: Schema.Array(RevisionSchema),
  settings: Schema.NullOr(SettingsSchema),
  suggestions: Schema.Array(SuggestionSchema),
  version: Schema.Literal(BACKUP_VERSION),
});

type Backup = typeof BackupSchema.Type;

const decodeBackup = Schema.decodeUnknownEffect(BackupSchema);

export const exportBackup = async (): Promise<string> => {
  const [documents, revisions, passes, suggestions, passPrompts, settings] = await Promise.all([
    db.documents.toArray(),
    db.revisions.toArray(),
    db.passes.toArray(),
    db.suggestions.toArray(),
    db.passPrompts.toArray(),
    db.settings.get("settings"),
  ]);

  const backup: Backup = {
    documents: documents.map((document) => ({
      ...document,
      // SAFETY: TipTap JSONContent is plain JSON; it only lacks the Json type's index signature.
      content: document.content as Schema.Json,
    })),
    exportedAt: Date.now(),
    passes,
    passPrompts,
    revisions: revisions.map((revision) => ({
      ...revision,
      // SAFETY: TipTap JSONContent is plain JSON; it only lacks the Json type's index signature.
      content: revision.content as Schema.Json,
    })),
    settings: settings === undefined ? null : { ...settings, llm: { ...settings.llm, apiKey: "" } },
    suggestions,
    version: BACKUP_VERSION,
  };

  return JSON.stringify(backup, null, 2);
};

export interface ImportSummary {
  readonly documents: number;
  readonly revisions: number;
  readonly suggestions: number;
}

/**
 * Convert validated backup rows to domain rows. Ids are plain strings in the
 * file; the brands are reapplied here, after validation.
 */
const toDomain = (backup: Backup) => ({
  documents: backup.documents.map((document): WorkshopDocument => ({
    ...document,
    // SAFETY: Schema.Json validated the value; the editor schema re-validates on load.
    content: document.content as JSONContent,
    // SAFETY: ids were produced by this app's exporter.
    id: document.id as DocumentId,
  })),
  passes: backup.passes.map((pass): Pass => ({
    ...pass,
    // SAFETY: ids were produced by this app's exporter.
    documentId: pass.documentId as DocumentId,
    hidden: pass.hidden ?? false,
    // SAFETY: ids were produced by this app's exporter.
    id: pass.id as PassId,
  })),
  passPrompts: backup.passPrompts.map(
    // SAFETY: ids were produced by this app's exporter.
    (prompt): PassPrompt => ({ ...prompt, id: prompt.id as PassPromptId }),
  ),
  revisions: backup.revisions.map((revision): Revision => ({
    ...revision,
    // SAFETY: Schema.Json validated the value; the editor schema re-validates on load.
    content: revision.content as JSONContent,
    // SAFETY: ids were produced by this app's exporter.
    documentId: revision.documentId as DocumentId,
    // SAFETY: ids were produced by this app's exporter.
    id: revision.id as RevisionId,
  })),
  suggestions: backup.suggestions.map((suggestion): Suggestion => ({
    ...suggestion,
    // SAFETY: ids were produced by this app's exporter.
    documentId: suggestion.documentId as DocumentId,
    // SAFETY: ids were produced by this app's exporter.
    id: suggestion.id as SuggestionId,
    // SAFETY: ids were produced by this app's exporter.
    passId: suggestion.passId as PassId,
  })),
});

/**
 * Merge a backup into the local database. Rows are upserted by id, so
 * importing the same file twice is harmless. The current API key is kept.
 */
export const importBackup = (text: string): Effect.Effect<ImportSummary, BackupParseError> =>
  Effect.try({
    catch: () => new BackupParseError({ message: "The file is not JSON." }),
    try: () => JSON.parse(text),
  }).pipe(
    Effect.flatMap((json) =>
      decodeBackup(json).pipe(
        Effect.mapError(
          (error) => new BackupParseError({ message: `Not a workshop backup: ${error.message}` }),
        ),
      ),
    ),
    Effect.flatMap((backup) =>
      Effect.promise(async (): Promise<ImportSummary> => {
        const rows = toDomain(backup);

        await db.transaction(
          "rw",
          [db.documents, db.revisions, db.passes, db.suggestions, db.passPrompts, db.settings],
          async () => {
            await db.documents.bulkPut(rows.documents);
            await db.revisions.bulkPut(rows.revisions);
            await db.passes.bulkPut(rows.passes);
            await db.suggestions.bulkPut(rows.suggestions);
            await db.passPrompts.bulkPut(rows.passPrompts);

            if (backup.settings !== null) {
              const current = await db.settings.get("settings");

              const merged: Settings = {
                ...backup.settings,
                llm: { ...backup.settings.llm, apiKey: current?.llm.apiKey ?? "" },
              };

              await db.settings.put(merged);
            }
          },
        );

        return {
          documents: rows.documents.length,
          revisions: rows.revisions.length,
          suggestions: rows.suggestions.length,
        };
      }),
    ),
  );

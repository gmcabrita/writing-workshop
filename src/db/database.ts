import Dexie, { type EntityTable } from "dexie";

import {
  type ContextFile,
  DEFAULT_LEAD_MAX_LENGTH,
  type Pass,
  type PassPrompt,
  type Revision,
  type Settings,
  type Suggestion,
  type WorkshopDocument,
} from "@/domain/model";

/**
 * Local-only IndexedDB store. Everything the writer produces lives here;
 * nothing leaves the browser except LLM requests the writer triggers.
 */
export class WorkshopDatabase extends Dexie {
  documents!: EntityTable<WorkshopDocument, "id">;
  revisions!: EntityTable<Revision, "id">;
  passes!: EntityTable<Pass, "id">;
  suggestions!: EntityTable<Suggestion, "id">;
  passPrompts!: EntityTable<PassPrompt, "id">;
  contextFiles!: EntityTable<ContextFile, "id">;
  settings!: EntityTable<Settings, "id">;

  constructor() {
    super("writing-workshop");

    this.version(1).stores({
      documents: "id, updatedAt",
      passes: "id, documentId, createdAt",
      passPrompts: "id, order",
      revisions: "id, documentId, createdAt",
      settings: "id",
      suggestions: "id, passId, documentId, [documentId+status]",
    });

    // Version 2 adds the document lead, per-document context files, and
    // the note target (document or lead). Rows written by version 1 have
    // none of these fields, so the upgrade fills them in and the rest of
    // the app can rely on them being present.
    this.version(2)
      .stores({
        contextFiles: "id, documentId, createdAt",
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<WorkshopDocument, string>("documents")
          .toCollection()
          .modify({ lead: "" });
        await transaction
          .table<Settings, string>("settings")
          .toCollection()
          .modify({ leadMaxLength: DEFAULT_LEAD_MAX_LENGTH });
        await transaction
          .table<Suggestion, string>("suggestions")
          .toCollection()
          .modify({ target: "document" });
      });
  }
}

export const db = new WorkshopDatabase();

import Dexie, { type EntityTable } from "dexie";

import type {
  Pass,
  PassPrompt,
  Revision,
  Settings,
  Suggestion,
  WorkshopDocument,
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
  }
}

export const db = new WorkshopDatabase();

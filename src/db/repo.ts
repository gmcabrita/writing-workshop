import type { JSONContent } from "@tiptap/core";

import { db } from "@/db/database";
import {
  DEFAULT_PASS_PROMPTS,
  DEFAULT_SETTINGS,
  type DocumentId,
  EMPTY_DOCUMENT_CONTENT,
  type LlmConfig,
  newDocumentId,
  newPassId,
  newPassPromptId,
  newRevisionId,
  newSuggestionId,
  type Pass,
  type PassId,
  type PassPrompt,
  type PassPromptId,
  type PassStatus,
  type PriorNote,
  type Revision,
  type RevisionId,
  type Settings,
  type Suggestion,
  type SuggestionId,
  type SuggestionStatus,
  TONE_COUNT,
  type WorkshopDocument,
} from "@/domain/model";

/* Documents */

export const createDocumentWithContent = async (
  title: string,
  content: JSONContent,
): Promise<WorkshopDocument> => {
  const now = Date.now();

  const document: WorkshopDocument = {
    content,
    createdAt: now,
    id: newDocumentId(),
    title,
    updatedAt: now,
  };

  await db.documents.add(document);

  return document;
};

export const createDocument = (title: string): Promise<WorkshopDocument> =>
  createDocumentWithContent(title, EMPTY_DOCUMENT_CONTENT);

export const saveDocumentContent = (id: DocumentId, content: JSONContent): Promise<number> =>
  db.documents.update(id, { content, updatedAt: Date.now() });

export const renameDocument = (id: DocumentId, title: string): Promise<number> =>
  db.documents.update(id, { title, updatedAt: Date.now() });

export const deleteDocument = (id: DocumentId): Promise<void> =>
  db.transaction("rw", [db.documents, db.revisions, db.passes, db.suggestions], async () => {
    await db.documents.delete(id);
    await db.revisions.where("documentId").equals(id).delete();
    await db.passes.where("documentId").equals(id).delete();
    await db.suggestions.where("documentId").equals(id).delete();
  });

/* Revisions */

export const createRevision = async (
  documentId: DocumentId,
  content: JSONContent,
  label: string,
  major: boolean,
): Promise<Revision> => {
  const revision: Revision = {
    content,
    createdAt: Date.now(),
    documentId,
    id: newRevisionId(),
    label,
    major,
  };

  await db.revisions.add(revision);

  return revision;
};

export const setRevisionMajor = (id: RevisionId, major: boolean): Promise<number> =>
  db.revisions.update(id, { major });

export const relabelRevision = (id: RevisionId, label: string): Promise<number> =>
  db.revisions.update(id, { label });

export const deleteRevision = (id: RevisionId): Promise<void> => db.revisions.delete(id);

/* Passes and suggestions */

export const createPass = async (documentId: DocumentId, promptName: string): Promise<Pass> => {
  const existing = await db.passes.where("documentId").equals(documentId).count();

  const pass: Pass = {
    createdAt: Date.now(),
    documentId,
    error: null,
    hidden: false,
    id: newPassId(),
    promptName,
    status: "running",
    tone: existing % TONE_COUNT,
  };

  await db.passes.add(pass);

  return pass;
};

export const finishPass = (id: PassId, status: PassStatus, error: string | null): Promise<number> =>
  db.passes.update(id, { error, status });

export const setPassHidden = (id: PassId, hidden: boolean): Promise<number> =>
  db.passes.update(id, { hidden });

export const deletePass = (id: PassId): Promise<void> =>
  db.transaction("rw", [db.passes, db.suggestions], async () => {
    await db.passes.delete(id);
    await db.suggestions.where("passId").equals(id).delete();
  });

export interface SuggestionDraft {
  readonly comment: string;
  readonly quote: string;
  readonly replacement: string | null;
}

export const addSuggestions = async (
  documentId: DocumentId,
  passId: PassId,
  drafts: ReadonlyArray<SuggestionDraft>,
): Promise<ReadonlyArray<Suggestion>> => {
  const now = Date.now();

  const suggestions = drafts.map((draft, order): Suggestion => ({
    comment: draft.comment,
    createdAt: now,
    documentId,
    id: newSuggestionId(),
    order,
    passId,
    quote: draft.quote,
    replacement: draft.replacement,
    status: "open",
  }));

  await db.suggestions.bulkAdd(suggestions);

  return suggestions;
};

export const setSuggestionStatus = (id: SuggestionId, status: SuggestionStatus): Promise<number> =>
  db.suggestions.update(id, { status });

/** Earlier notes on a document, newest first, as context for the next pass. */
export const loadPriorNotes = async (documentId: DocumentId): Promise<ReadonlyArray<PriorNote>> => {
  const rows = await db.suggestions
    .where("documentId")
    .equals(documentId)
    .reverse()
    .sortBy("createdAt");

  return rows
    .filter((row) => row.comment.trim().length > 0)
    .map((row): PriorNote => ({ comment: row.comment, quote: row.quote, status: row.status }));
};

export const reopenSuggestions = (ids: ReadonlyArray<SuggestionId>): Promise<number> =>
  db.suggestions
    .where("id")
    .anyOf([...ids])
    .modify({ status: "open" });

export const updateSuggestionComment = (id: SuggestionId, comment: string): Promise<number> =>
  db.suggestions.update(id, { comment });

export const deleteSuggestion = (id: SuggestionId): Promise<void> => db.suggestions.delete(id);

/* Prompts and settings */

export const loadSettings = async (): Promise<Settings> =>
  (await db.settings.get("settings")) ?? DEFAULT_SETTINGS;

export const saveSettings = (settings: Settings): Promise<"settings"> => db.settings.put(settings);

export const saveLlmConfig = async (llm: LlmConfig): Promise<"settings"> => {
  const current = await loadSettings();

  return saveSettings({ ...current, llm });
};

export const saveSystemPrompt = async (systemPrompt: string): Promise<"settings"> => {
  const current = await loadSettings();

  return saveSettings({ ...current, systemPrompt });
};

export const createPassPrompt = async (name: string, prompt: string): Promise<PassPrompt> => {
  const count = await db.passPrompts.count();
  const passPrompt: PassPrompt = { id: newPassPromptId(), name, order: count, prompt };

  await db.passPrompts.add(passPrompt);

  return passPrompt;
};

export const updatePassPrompt = (id: PassPromptId, name: string, prompt: string): Promise<number> =>
  db.passPrompts.update(id, { name, prompt });

export const deletePassPrompt = (id: PassPromptId): Promise<void> => db.passPrompts.delete(id);

/** Replace every pass prompt with the built-in set. */
export const restoreDefaultPassPrompts = (): Promise<void> =>
  db.transaction("rw", db.passPrompts, async () => {
    await db.passPrompts.clear();
    await db.passPrompts.bulkAdd(
      DEFAULT_PASS_PROMPTS.map((prompt): PassPrompt => ({ ...prompt, id: newPassPromptId() })),
    );
  });

/**
 * A pass only runs while its tab is open. Any pass still marked running at
 * startup was cut off by a reload or crash.
 */
export const failInterruptedPasses = (): Promise<number> =>
  db.passes
    .filter((pass) => pass.status === "running")
    .modify({ error: "Interrupted before it finished. Run it again.", status: "error" });

/**
 * Ask the browser not to evict this origin's storage under disk pressure.
 * Chrome grants it silently for engaged sites; Firefox may prompt. Returns
 * whether storage is now persistent.
 */
export const requestPersistentStorage = async (): Promise<boolean> => {
  if (!("storage" in navigator) || navigator.storage.persist === undefined) {
    return false;
  }

  if (await navigator.storage.persisted()) {
    return true;
  }

  return navigator.storage.persist();
};

/** Populate default prompts the first time the app runs and repair leftover state. */
export const seedDefaults = async (): Promise<void> => {
  const count = await db.passPrompts.count();

  if (count === 0) {
    await restoreDefaultPassPrompts();
  }

  await failInterruptedPasses();
};

import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { useLiveQuery } from "dexie-react-hooks";
import { Effect } from "effect";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { CommentaryPanel } from "@/components/CommentaryPanel";
import { DocumentSidebar } from "@/components/DocumentSidebar";
import { PassToolbar } from "@/components/PassToolbar";
import { RevisionsDialog } from "@/components/RevisionsDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Toaster } from "@/components/ui/sonner";
import { exportBackup, importBackup } from "@/db/backup";
import { db } from "@/db/database";
import {
  addSuggestions,
  createDocument,
  createDocumentWithContent,
  createRevision,
  deleteDocument,
  deletePass,
  deleteSuggestion,
  renameDocument,
  reopenSuggestions,
  requestPersistentStorage,
  saveDocumentContent,
  seedDefaults,
  setSuggestionStatus,
  updateSuggestionComment,
} from "@/db/repo";
import {
  DEFAULT_SETTINGS,
  type DocumentId,
  MANUAL_PASS_ID,
  type Pass,
  type PassId,
  type PassPrompt,
  type Revision,
  type Suggestion,
  type SuggestionId,
  type WorkshopDocument,
} from "@/domain/model";
import type { TextRange } from "@/domain/textIndex";
import { contentToMarkdown, markdownToContent } from "@/editor/markdown";
import { ProseEditor } from "@/editor/ProseEditor";
import {
  acceptSuggestionInEditor,
  dismissSuggestionInEditor,
  revealSuggestionInEditor,
  sortByDocumentOrder,
} from "@/editor/suggestionActions";
import { usePassRunner } from "@/hooks/usePassRunner";
import { downloadTextFile, filenameStem, pickTextFile } from "@/lib/files";
import { runtime } from "@/runtime";

const ACTIVE_DOCUMENT_KEY = "writing-workshop:active-document";

// Stable empty values so live-query fallbacks do not defeat memoisation.
const NO_PROMPTS: ReadonlyArray<PassPrompt> = [];

const NO_PASSES: ReadonlyArray<Pass> = [];

const NO_SUGGESTIONS: ReadonlyArray<Suggestion> = [];

const backupToFile = async (): Promise<void> => {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(
    `writing-workshop-backup-${stamp}.json`,
    await exportBackup(),
    "application/json",
  );
};

const restoreFromFile = async (): Promise<void> => {
  const picked = await pickTextFile(".json,application/json");

  if (picked === null) {
    return;
  }

  await runtime.runPromise(
    importBackup(picked.text).pipe(
      Effect.tap((summary) =>
        Effect.sync(() =>
          toast.success(
            `Restored ${summary.documents} documents, ${summary.revisions} revisions, ${summary.suggestions} notes.`,
          ),
        ),
      ),
      Effect.catch((error) => Effect.sync(() => toast.error(error.message))),
    ),
  );
};

const confirmDeleteDocument = async (id: DocumentId): Promise<void> => {
  if (!window.confirm("Delete this document and all of its notes and revisions?")) {
    return;
  }

  await deleteDocument(id);
};

/** Synthetic pass shown for notes the writer adds by hand. */
const manualPass = (documentId: DocumentId): Pass => ({
  createdAt: 0,
  documentId,
  error: null,
  id: MANUAL_PASS_ID,
  promptName: "Note",
  status: "done",
  tone: 0,
});

const readStoredDocumentId = (): DocumentId | null => {
  const stored = localStorage.getItem(ACTIVE_DOCUMENT_KEY);

  // SAFETY: this key is only ever written with a DocumentId; a stale id is harmless.
  return stored === null ? null : (stored as DocumentId);
};

/**
 * Latest ProseMirror document, refreshed on every transaction so derived
 * data (note order, active highlight) follows edits.
 */
const useEditorDoc = (editor: Editor | null): ProseMirrorNode | null => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (editor === null) {
        return () => {};
      }

      editor.on("transaction", onChange);

      return () => {
        editor.off("transaction", onChange);
      };
    },
    [editor],
  );

  return useSyncExternalStore(subscribe, () => editor?.state.doc ?? null);
};

interface WorkspaceProps {
  readonly doc: WorkshopDocument;
}

/**
 * Everything for one open document: editor, commentary, passes, revisions.
 * Keyed by document id from the parent so switching documents remounts it.
 */
const Workspace = ({ doc }: WorkspaceProps) => {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [activeId, setActiveId] = useState<SuggestionId | null>(null);
  const pmDoc = useEditorDoc(editor);
  const [revisionsOpen, setRevisionsOpen] = useState(false);

  const settings = useLiveQuery(() => db.settings.get("settings"), []) ?? DEFAULT_SETTINGS;
  const prompts = useLiveQuery(() => db.passPrompts.orderBy("order").toArray(), []) ?? NO_PROMPTS;

  const passes =
    useLiveQuery(
      () => db.passes.where("documentId").equals(doc.id).sortBy("createdAt"),
      [doc.id],
    ) ?? NO_PASSES;

  const suggestions =
    useLiveQuery(() => db.suggestions.where("documentId").equals(doc.id).toArray(), [doc.id]) ??
    NO_SUGGESTIONS;

  const runner = usePassRunner(editor, doc.id, settings);

  // Mirror the active card onto its highlight. Done on the DOM rather than
  // through a ProseMirror transaction so it never touches undo history.
  useEffect(() => {
    if (editor === null) {
      return;
    }

    const root = editor.view.dom;

    for (const element of root.querySelectorAll(".suggestion-mark.is-active")) {
      element.classList.remove("is-active");
    }

    if (activeId !== null) {
      for (const element of root.querySelectorAll(`[data-suggestion-id="${activeId}"]`)) {
        element.classList.add("is-active");
      }
    }
  }, [activeId, editor, pmDoc]);

  /**
   * Suggestions that still have a highlight, in document order. The mark in
   * the document is the source of truth: editor undo can bring back a
   * highlight that was accepted or dismissed, and it must show again.
   */
  const orderedSuggestions = useMemo(
    () => (pmDoc === null ? NO_SUGGESTIONS : sortByDocumentOrder(pmDoc, suggestions)),
    [pmDoc, suggestions],
  );

  // Reconcile status with the document: a highlight that came back via undo
  // reopens its note.
  useEffect(() => {
    const reopened = orderedSuggestions.filter((suggestion) => suggestion.status !== "open");

    if (reopened.length > 0) {
      void reopenSuggestions(reopened.map((suggestion) => suggestion.id));
    }
  }, [orderedSuggestions]);

  const passesById = useMemo(() => {
    const map = new Map<PassId, Pass>(passes.map((pass) => [pass.id, pass]));
    map.set(MANUAL_PASS_ID, manualPass(doc.id));

    return map;
  }, [doc.id, passes]);

  const activeIndex = orderedSuggestions.findIndex((suggestion) => suggestion.id === activeId);

  const select = useCallback(
    (id: SuggestionId) => {
      setActiveId(id);

      if (editor !== null) {
        revealSuggestionInEditor(editor, id);
      }
    },
    [editor],
  );

  /** Clicking a stack of overlapping highlights cycles through them. */
  const selectFromClick = useCallback(
    (ids: ReadonlyArray<SuggestionId>) => {
      const current = activeId === null ? -1 : ids.indexOf(activeId);
      const next = ids[(current + 1) % ids.length];

      if (next !== undefined) {
        select(next);
      }
    },
    [activeId, select],
  );

  const step = useCallback(
    (delta: number) => {
      if (orderedSuggestions.length === 0) {
        return;
      }

      const base = activeIndex === -1 ? (delta > 0 ? -1 : 0) : activeIndex;
      const next = (base + delta + orderedSuggestions.length) % orderedSuggestions.length;
      const target = orderedSuggestions[next];

      if (target !== undefined) {
        select(target.id);
      }
    },
    [activeIndex, orderedSuggestions, select],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey) {
        return;
      }

      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        step(1);
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        step(-1);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step]);

  const advanceAfterResolve = (resolved: Suggestion) => {
    const index = orderedSuggestions.findIndex((suggestion) => suggestion.id === resolved.id);
    const next = orderedSuggestions[index + 1] ?? orderedSuggestions[index - 1] ?? null;
    setActiveId(next === null ? null : next.id);
  };

  const accept = async (suggestion: Suggestion) => {
    if (editor === null) {
      return;
    }

    acceptSuggestionInEditor(editor, suggestion);
    advanceAfterResolve(suggestion);
    await setSuggestionStatus(suggestion.id, "accepted");
  };

  const dismiss = async (suggestion: Suggestion) => {
    if (editor === null) {
      return;
    }

    dismissSuggestionInEditor(editor, suggestion.id);
    advanceAfterResolve(suggestion);
    await setSuggestionStatus(suggestion.id, "dismissed");
  };

  const remove = async (suggestion: Suggestion) => {
    if (editor !== null) {
      dismissSuggestionInEditor(editor, suggestion.id);
    }

    advanceAfterResolve(suggestion);
    await deleteSuggestion(suggestion.id);
  };

  const annotate = async (range: TextRange, quote: string) => {
    if (editor === null) {
      return;
    }

    const [saved] = await addSuggestions(doc.id, MANUAL_PASS_ID, [
      { comment: "", quote, replacement: null },
    ]);

    if (saved === undefined) {
      return;
    }

    editor
      .chain()
      .addSuggestionMark(range, { id: saved.id, passId: MANUAL_PASS_ID, tone: 0 })
      .run();
    setActiveId(saved.id);
  };

  const removePass = async (pass: Pass) => {
    if (editor !== null) {
      const ids = await db.suggestions.where("passId").equals(pass.id).primaryKeys();
      let chain = editor.chain();

      for (const id of ids) {
        chain = chain.removeSuggestionMark(id);
      }

      chain.run();
    }

    await deletePass(pass.id);
  };

  const restore = async (revision: Revision) => {
    if (editor === null) {
      return;
    }

    // Keep the current state recoverable before replacing it.
    await createRevision(doc.id, editor.getJSON(), "Before restore", false);
    editor.commands.setContent(revision.content);
    await saveDocumentContent(doc.id, revision.content);
    setRevisionsOpen(false);
    toast.success(`Restored “${revision.label.length > 0 ? revision.label : "snapshot"}”.`);
  };

  const persist = useCallback(
    (content: JSONContent) => void saveDocumentContent(doc.id, content),
    [doc.id],
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PassToolbar
        activeIndex={activeIndex}
        onDeletePass={(pass) => void removePass(pass)}
        onExportMarkdown={() => {
          const content = editor?.getJSON() ?? doc.content;
          downloadTextFile(
            `${filenameStem(doc.title)}.md`,
            contentToMarkdown(content),
            "text/markdown",
          );
        }}
        onNext={() => step(1)}
        onOpenRevisions={() => setRevisionsOpen(true)}
        onPrevious={() => step(-1)}
        openCount={orderedSuggestions.length}
        passes={passes}
        prompts={prompts}
        runner={runner}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-6xl gap-8 px-8 py-10">
          <div className="min-w-0 flex-1">
            <input
              aria-label="Document title"
              className="mb-6 w-full bg-transparent text-4xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/50"
              defaultValue={doc.title}
              onBlur={(event) => void renameDocument(doc.id, event.target.value.trim())}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  // Blur first so keystrokes cannot land in the title while
                  // the editor finishes taking focus.
                  event.currentTarget.blur();
                  editor?.commands.focus("start");
                }
              }}
              placeholder="Untitled"
            />
            <ProseEditor
              initialContent={doc.content}
              onAnnotate={(range, quote) => void annotate(range, quote)}
              onChange={persist}
              onReady={setEditor}
              onSuggestionClick={selectFromClick}
            />
          </div>
          <div className="w-80 shrink-0">
            <CommentaryPanel
              activeId={activeId}
              editor={editor}
              onAccept={(suggestion) => void accept(suggestion)}
              onCommentChange={(id, comment) => void updateSuggestionComment(id, comment)}
              onDelete={(suggestion) => void remove(suggestion)}
              onDismiss={(suggestion) => void dismiss(suggestion)}
              onSelect={select}
              passes={passesById}
              suggestions={orderedSuggestions}
            />
          </div>
        </div>
      </div>

      <RevisionsDialog
        currentContent={() => editor?.getJSON() ?? doc.content}
        documentId={doc.id}
        onOpenChange={setRevisionsOpen}
        onRestore={(revision) => void restore(revision)}
        open={revisionsOpen}
      />
    </div>
  );
};

const App = () => {
  const documents = useLiveQuery(() => db.documents.orderBy("updatedAt").reverse().toArray(), []);
  const settings = useLiveQuery(() => db.settings.get("settings"), []) ?? DEFAULT_SETTINGS;
  const [activeDocumentId, setActiveDocumentId] = useState<DocumentId | null>(readStoredDocumentId);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void seedDefaults();
    void requestPersistentStorage();
  }, []);

  useEffect(() => {
    if (activeDocumentId === null) {
      localStorage.removeItem(ACTIVE_DOCUMENT_KEY);
    } else {
      localStorage.setItem(ACTIVE_DOCUMENT_KEY, activeDocumentId);
    }
  }, [activeDocumentId]);

  const create = async () => {
    const created = await createDocument("");
    setActiveDocumentId(created.id);
  };

  const importMarkdown = async () => {
    const picked = await pickTextFile(".md,.markdown,.txt,text/markdown,text/plain");

    if (picked === null) {
      return;
    }

    const created = await createDocumentWithContent(
      picked.name.replace(/\.(md|markdown|txt)$/i, ""),
      markdownToContent(picked.text),
    );

    setActiveDocumentId(created.id);
    toast.success(`Imported “${created.title}”.`);
  };

  // Fall back to the most recent document when the stored one is gone.
  const activeDocument =
    documents?.find((entry) => entry.id === activeDocumentId) ?? documents?.[0] ?? null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <DocumentSidebar
        activeId={activeDocumentId}
        documents={documents ?? []}
        onCreate={() => void create()}
        onDelete={(id) => void confirmDeleteDocument(id)}
        onExportBackup={() => void backupToFile()}
        onImportBackup={() => void restoreFromFile()}
        onImportMarkdown={() => void importMarkdown()}
        onOpenSettings={() => setSettingsOpen(true)}
        onSelect={setActiveDocumentId}
      />
      {activeDocument === null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {documents === undefined ? "Loading…" : "Create a document to begin."}
        </div>
      ) : (
        <Workspace doc={activeDocument} key={activeDocument.id} />
      )}
      <SettingsDialog onOpenChange={setSettingsOpen} open={settingsOpen} settings={settings} />
      <Toaster position="bottom-right" />
    </div>
  );
};

export default App;

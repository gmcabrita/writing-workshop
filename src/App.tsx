import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { useLiveQuery } from "dexie-react-hooks";
import { Effect } from "effect";
import { PanelLeftOpenIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { CommentaryPanel } from "@/components/CommentaryPanel";
import { ContextDialog } from "@/components/ContextDialog";
import { DocumentSidebar } from "@/components/DocumentSidebar";
import { LeadField } from "@/components/LeadField";
import { PassToolbar } from "@/components/PassToolbar";
import { ResizeHandle } from "@/components/ResizeHandle";
import { RevisionsDialog } from "@/components/RevisionsDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Button } from "@/components/ui/button";
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
  saveDocumentLead,
  seedDefaults,
  setPassHidden,
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
import { applyLeadReplacement } from "@/domain/leadNotes";
import { buildTextIndex, type TextRange } from "@/domain/textIndex";
import { formatStats, textStats } from "@/domain/wordCount";
import { contentToMarkdown, markdownToContent } from "@/editor/markdown";
import { ProseEditor } from "@/editor/ProseEditor";
import {
  acceptSuggestionInEditor,
  applySuggestionMarks,
  dismissSuggestionInEditor,
  placeSuggestionAtSelection,
  revealSuggestionInEditor,
  sortByDocumentOrder,
} from "@/editor/suggestionActions";
import { usePassRunner } from "@/hooks/usePassRunner";
import { useResizableWidth } from "@/hooks/useResizableWidth";
import { type ThemePreference, useTheme } from "@/hooks/useTheme";
import { downloadTextFile, filenameStem, pickTextFile } from "@/lib/files";
import { runtime } from "@/runtime";

const ACTIVE_DOCUMENT_KEY = "writing-workshop:active-document";

const SIDEBAR_COLLAPSED_KEY = "writing-workshop:sidebar-collapsed";

const NOTES_COLLAPSED_KEY = "writing-workshop:notes-collapsed";

/** Order the theme button cycles through. */
const NEXT_THEME: Record<ThemePreference, ThemePreference> = {
  dark: "system",
  light: "dark",
  system: "light",
};

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

/** Resolves to true when rows were written, so the caller can reload the open document. */
const restoreFromFile = async (): Promise<boolean> => {
  const picked = await pickTextFile(".json,application/json");

  if (picked === null) {
    return false;
  }

  return runtime.runPromise(
    importBackup(picked.text).pipe(
      Effect.tap((summary) =>
        Effect.sync(() =>
          toast.success(
            `Restored ${summary.documents} documents, ${summary.revisions} revisions, ${summary.suggestions} notes.`,
          ),
        ),
      ),
      Effect.map(() => true),
      Effect.catch((error) =>
        Effect.sync(() => {
          toast.error(error.message);

          return false;
        }),
      ),
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
  hidden: false,
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
 * Active and hidden highlight styling is applied through a generated
 * stylesheet keyed on the marks' data attributes. Toggling classes on the
 * mark elements does not work: ProseMirror's DOM observer treats foreign
 * attribute changes as damage and redraws the marks. A transaction would
 * pollute undo history.
 */
const highlightStyles = (
  activeId: SuggestionId | null,
  hiddenPassIds: ReadonlySet<string>,
): string => {
  const rules: Array<string> = [];

  if (activeId !== null) {
    rules.push(
      `.suggestion-mark[data-suggestion-id="${activeId}"] { background: var(--mark-strong); }`,
    );
  }

  for (const passId of hiddenPassIds) {
    rules.push(
      `.suggestion-mark[data-pass-id="${passId}"] { background: transparent; border-color: transparent; cursor: text; }`,
    );
  }

  return rules.join("\n");
};

/** Non-empty editor selection as a range, or null. Refreshed on every transaction. */
const useEditorSelection = (editor: Editor | null): TextRange | null => {
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

  // Snapshot must be referentially stable while unchanged, so cache by position.
  const cache = useRef<TextRange | null>(null);

  return useSyncExternalStore(subscribe, () => {
    const current = editor?.state.selection;

    if (current === undefined || current.empty) {
      cache.current = null;

      return null;
    }

    if (cache.current?.from !== current.from || cache.current.to !== current.to) {
      cache.current = { from: current.from, to: current.to };
    }

    return cache.current;
  });
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
  const selection = useEditorSelection(editor);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  // Local copy so the pass runner always sees what is on screen, even
  // before the live query catches up with the last keystroke.
  const [lead, setLead] = useState(doc.lead);
  const leadRef = useRef<HTMLDivElement | null>(null);

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

  const contextCount =
    useLiveQuery(() => db.contextFiles.where("documentId").equals(doc.id).count(), [doc.id]) ?? 0;

  const runner = usePassRunner(editor, doc.id, lead, settings);

  const changeLead = useCallback(
    (next: string) => {
      setLead(next);
      void saveDocumentLead(doc.id, next);
    },
    [doc.id],
  );

  const statsLabel = useMemo(() => {
    if (pmDoc === null) {
      return "";
    }

    const index = buildTextIndex(pmDoc);

    const text =
      selection === null
        ? index.text
        : index.text.slice(index.toOffset(selection.from), index.toOffset(selection.to));

    return formatStats(textStats(text));
  }, [pmDoc, selection]);

  const hiddenPassIds = useMemo(
    () => new Set<string>(passes.filter((pass) => pass.hidden).map((pass) => pass.id)),
    [passes],
  );

  /** Notes from passes the writer has not hidden. */
  const visibleSuggestions = useMemo(
    () => suggestions.filter((suggestion) => !hiddenPassIds.has(suggestion.passId)),
    [hiddenPassIds, suggestions],
  );

  /**
   * Suggestions that still have a highlight, in document order. The mark in
   * the document is the source of truth: editor undo can bring back a
   * highlight that was accepted or dismissed, and it must show again.
   */
  const orderedSuggestions = useMemo(
    () => (pmDoc === null ? NO_SUGGESTIONS : sortByDocumentOrder(pmDoc, visibleSuggestions)),
    [pmDoc, visibleSuggestions],
  );

  // Reconcile status with the document: a highlight that came back via undo
  // reopens its note.
  useEffect(() => {
    const reopened = orderedSuggestions.filter((suggestion) => suggestion.status !== "open");

    if (reopened.length > 0) {
      void reopenSuggestions(reopened.map((suggestion) => suggestion.id));
    }
  }, [orderedSuggestions]);

  /** Open notes about the lead. They have no highlight; status is the source of truth. */
  const leadNotes = useMemo(
    () =>
      visibleSuggestions.filter(
        (suggestion) => suggestion.target === "lead" && suggestion.status === "open",
      ),
    [visibleSuggestions],
  );

  /** Notes the writer steps through: lead first, then the document in order. */
  const navigable = useMemo(
    () => [...leadNotes, ...orderedSuggestions],
    [leadNotes, orderedSuggestions],
  );

  /** Open document notes with no highlight in the document. */
  const unplaced = useMemo(() => {
    const placedIds = new Set(orderedSuggestions.map((suggestion) => suggestion.id));

    return visibleSuggestions.filter(
      (suggestion) =>
        suggestion.target === "document" &&
        suggestion.status === "open" &&
        !placedIds.has(suggestion.id),
    );
  }, [orderedSuggestions, visibleSuggestions]);

  /** Accepted or dismissed notes whose highlight is gone, newest first. */
  const resolved = useMemo(() => {
    const placedIds = new Set(orderedSuggestions.map((suggestion) => suggestion.id));

    return visibleSuggestions
      .filter((suggestion) => suggestion.status !== "open" && !placedIds.has(suggestion.id))
      .toSorted((a, b) => b.createdAt - a.createdAt);
  }, [orderedSuggestions, visibleSuggestions]);

  const passesById = useMemo(() => {
    const map = new Map<PassId, Pass>(passes.map((pass) => [pass.id, pass]));
    map.set(MANUAL_PASS_ID, manualPass(doc.id));

    return map;
  }, [doc.id, passes]);

  const activeIndex = navigable.findIndex((suggestion) => suggestion.id === activeId);

  const [notesCollapsed, setNotesCollapsed] = useState(
    () => localStorage.getItem(NOTES_COLLAPSED_KEY) === "true",
  );

  useEffect(() => {
    localStorage.setItem(NOTES_COLLAPSED_KEY, String(notesCollapsed));
  }, [notesCollapsed]);

  // Selecting a note from the editor (highlight click, prev/next) brings the
  // notes column back so the selected card is visible.
  const select = useCallback(
    (id: SuggestionId) => {
      setActiveId(id);
      setNotesCollapsed(false);

      if (leadNotes.some((note) => note.id === id)) {
        leadRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (editor !== null) {
        revealSuggestionInEditor(editor, id);
      }
    },
    [editor, leadNotes],
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
      if (navigable.length === 0) {
        return;
      }

      const base = activeIndex === -1 ? (delta > 0 ? -1 : 0) : activeIndex;
      const next = (base + delta + navigable.length) % navigable.length;
      const target = navigable[next];

      if (target !== undefined) {
        select(target.id);
      }
    },
    [activeIndex, navigable, select],
  );

  const advanceAfterResolve = useCallback(
    (resolvedNote: Suggestion) => {
      const index = navigable.findIndex((suggestion) => suggestion.id === resolvedNote.id);
      const next = navigable[index + 1] ?? navigable[index - 1] ?? null;
      setActiveId(next === null ? null : next.id);
    },
    [navigable],
  );

  const accept = useCallback(
    async (suggestion: Suggestion) => {
      if (editor === null) {
        return;
      }

      if (suggestion.target === "lead") {
        changeLead(applyLeadReplacement(lead, suggestion));
      } else {
        acceptSuggestionInEditor(editor, suggestion);
      }

      advanceAfterResolve(suggestion);
      await setSuggestionStatus(suggestion.id, "accepted");
    },
    [advanceAfterResolve, changeLead, editor, lead],
  );

  const dismiss = useCallback(
    async (suggestion: Suggestion) => {
      if (editor === null) {
        return;
      }

      if (suggestion.target === "document") {
        dismissSuggestionInEditor(editor, suggestion.id);
      }

      advanceAfterResolve(suggestion);
      await setSuggestionStatus(suggestion.id, "dismissed");
    },
    [advanceAfterResolve, editor],
  );

  const remove = async (suggestion: Suggestion) => {
    if (editor !== null && suggestion.target === "document") {
      dismissSuggestionInEditor(editor, suggestion.id);
    }

    advanceAfterResolve(suggestion);
    await deleteSuggestion(suggestion.id);
  };

  const activeSuggestion = navigable[activeIndex] ?? null;

  // Alt+↓/↑ (or Alt+J/K) step; Alt+Enter accepts; Alt+Backspace dismisses.
  // Handlers are read through a ref so the listener is attached once.
  const keyActions = useRef({ accept, activeSuggestion, dismiss, step });

  useEffect(() => {
    keyActions.current = { accept, activeSuggestion, dismiss, step };
  }, [accept, activeSuggestion, dismiss, step]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey) {
        return;
      }

      const actions = keyActions.current;

      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        actions.step(1);
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        actions.step(-1);
      } else if (event.key === "Enter" && actions.activeSuggestion !== null) {
        event.preventDefault();
        void actions.accept(actions.activeSuggestion);
      } else if (event.key === "Backspace" && actions.activeSuggestion !== null) {
        event.preventDefault();
        void actions.dismiss(actions.activeSuggestion);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * Bring a resolved note back. If its quote is still in the text the
   * highlight is restored; otherwise it lands in Unplaced. Lead notes have
   * no highlight and simply reappear beside the lead.
   */
  const reopen = async (suggestion: Suggestion) => {
    await reopenSuggestions([suggestion.id]);

    if (editor !== null && suggestion.target === "document") {
      const tone = passesById.get(suggestion.passId)?.tone ?? 0;
      applySuggestionMarks(editor, suggestion.passId, tone, [suggestion]);
    }

    setActiveId(suggestion.id);
  };

  const place = (suggestion: Suggestion) => {
    if (editor === null) {
      return;
    }

    const tone = passesById.get(suggestion.passId)?.tone ?? 0;

    if (!placeSuggestionAtSelection(editor, suggestion, tone)) {
      toast.message("Select the passage in the text first.");
    }
  };

  const annotate = async (range: TextRange, quote: string) => {
    if (editor === null) {
      return;
    }

    const [saved] = await addSuggestions(doc.id, MANUAL_PASS_ID, [
      { comment: "", quote, replacement: null, target: "document" },
    ]);

    if (saved === undefined) {
      return;
    }

    editor
      .chain()
      .addSuggestionMark(range, { id: saved.id, passId: MANUAL_PASS_ID, tone: 0 })
      .run();
    setActiveId(saved.id);
    setNotesCollapsed(false);
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

  const notesPanel = useResizableWidth({
    defaultWidth: 320,
    maxWidth: 640,
    minWidth: 200,
    side: "left",
    storageKey: "writing-workshop:notes-width",
  });

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <style>{highlightStyles(activeId, hiddenPassIds)}</style>
      <PassToolbar
        activeIndex={activeIndex}
        contextCount={contextCount}
        notesCollapsed={notesCollapsed}
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
        onOpenContext={() => setContextOpen(true)}
        onOpenRevisions={() => setRevisionsOpen(true)}
        onPrevious={() => step(-1)}
        onToggleNotes={() => setNotesCollapsed((collapsed) => !collapsed)}
        onTogglePass={(pass) => void setPassHidden(pass.id, !pass.hidden)}
        openCount={navigable.length}
        passes={passes}
        prompts={prompts}
        runner={runner}
        selection={selection}
        statsLabel={statsLabel}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-6 px-8 py-10">
          {/* Notes pin to the right edge; the editor centers in the rest with
              a cap that keeps prose lines readable. */}
          <div className="mx-auto w-full max-w-4xl min-w-0">
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
            <LeadField
              activeTone={
                activeSuggestion?.target === "lead"
                  ? (passesById.get(activeSuggestion.passId)?.tone ?? 0)
                  : null
              }
              maxLength={settings.leadMaxLength}
              onChange={changeLead}
              ref={leadRef}
              value={lead}
            />
            <ProseEditor
              initialContent={doc.content}
              onAnnotate={(range, quote) => void annotate(range, quote)}
              onChange={persist}
              onReady={setEditor}
              onSuggestionClick={selectFromClick}
            />
          </div>
          {notesCollapsed ? null : (
            <>
              <ResizeHandle
                active={notesPanel.resizing}
                label="Resize notes"
                onPointerDown={notesPanel.onHandlePointerDown}
              />
              <div className="shrink-0" style={{ width: notesPanel.width }}>
                <CommentaryPanel
                  activeId={activeId}
                  editor={editor}
                  leadNotes={leadNotes}
                  onAccept={(suggestion) => void accept(suggestion)}
                  onCommentChange={(id, comment) => void updateSuggestionComment(id, comment)}
                  onDelete={(suggestion) => void remove(suggestion)}
                  onDismiss={(suggestion) => void dismiss(suggestion)}
                  onPlace={place}
                  onReopen={(suggestion) => void reopen(suggestion)}
                  onSelect={select}
                  passes={passesById}
                  resolved={resolved}
                  suggestions={orderedSuggestions}
                  unplaced={unplaced}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <RevisionsDialog
        currentContent={() => editor?.getJSON() ?? doc.content}
        documentId={doc.id}
        onOpenChange={setRevisionsOpen}
        onRestore={(revision) => void restore(revision)}
        open={revisionsOpen}
      />
      <ContextDialog documentId={doc.id} onOpenChange={setContextOpen} open={contextOpen} />
    </div>
  );
};

const App = () => {
  const documents = useLiveQuery(() => db.documents.orderBy("updatedAt").reverse().toArray(), []);
  const settings = useLiveQuery(() => db.settings.get("settings"), []) ?? DEFAULT_SETTINGS;
  const [activeDocumentId, setActiveDocumentId] = useState<DocumentId | null>(readStoredDocumentId);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true",
  );

  const sidebar = useResizableWidth({
    defaultWidth: 240,
    maxWidth: 480,
    minWidth: 160,
    side: "right",
    storageKey: "writing-workshop:sidebar-width",
  });

  // Bumped after a backup restore. The workspace holds the editor content
  // and lead in local state, so it is remounted to pick up restored rows.
  const [restoreCount, setRestoreCount] = useState(0);
  const theme = useTheme();

  const restoreBackup = async () => {
    if (await restoreFromFile()) {
      setRestoreCount((count) => count + 1);
    }
  };

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

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

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
      {sidebarCollapsed ? (
        <div className="flex h-full shrink-0 flex-col border-r bg-sidebar p-1.5">
          <Button
            aria-label="Show sidebar"
            onClick={() => setSidebarCollapsed(false)}
            size="icon-sm"
            title="Show sidebar"
            variant="ghost"
          >
            <PanelLeftOpenIcon />
          </Button>
        </div>
      ) : (
        <>
          <DocumentSidebar
            activeId={activeDocumentId}
            documents={documents ?? []}
            onCollapse={() => setSidebarCollapsed(true)}
            onCreate={() => void create()}
            onCycleTheme={() => theme.setPreference(NEXT_THEME[theme.preference])}
            onDelete={(id) => void confirmDeleteDocument(id)}
            onExportBackup={() => void backupToFile()}
            onImportBackup={() => void restoreBackup()}
            onImportMarkdown={() => void importMarkdown()}
            onOpenSettings={() => setSettingsOpen(true)}
            onSelect={setActiveDocumentId}
            theme={theme.preference}
            width={sidebar.width}
          />
          <ResizeHandle
            active={sidebar.resizing}
            className="z-10 -mx-1"
            label="Resize sidebar"
            onPointerDown={sidebar.onHandlePointerDown}
          />
        </>
      )}
      {activeDocument === null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {documents === undefined ? "Loading…" : "Create a document to begin."}
        </div>
      ) : (
        <Workspace doc={activeDocument} key={`${activeDocument.id}:${restoreCount}`} />
      )}
      <SettingsDialog onOpenChange={setSettingsOpen} open={settingsOpen} settings={settings} />
      <Toaster position="bottom-right" theme={theme.resolved} />
    </div>
  );
};

export default App;

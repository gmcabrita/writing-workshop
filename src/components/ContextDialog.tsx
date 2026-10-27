import { useLiveQuery } from "dexie-react-hooks";
import { Effect } from "effect";
import { FileUpIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/db/database";
import { addContextFile, deleteContextFile, updateContextFile } from "@/db/repo";
import type { ContextFile, ContextFileKind, DocumentId } from "@/domain/model";
import { textStats } from "@/domain/wordCount";
import { CONTEXT_FILE_ACCEPT, ContextImportError, importContextFile } from "@/lib/contextImport";
import { pickFiles } from "@/lib/files";
import { runtime } from "@/runtime";

export interface ContextDialogProps {
  readonly documentId: DocumentId;
  onOpenChange(open: boolean): void;
  readonly open: boolean;
}

const KIND_LABEL: Record<ContextFileKind, string> = {
  html: "HTML",
  markdown: "Markdown",
  pdf: "PDF",
  text: "Text",
};

const formatWords = (words: number): string => `${words.toLocaleString()} words`;

/** One attached file: name and text are editable, so a bad PDF extraction can be fixed by hand. */
const ContextFileRow = ({ file }: { readonly file: ContextFile }) => {
  const [name, setName] = useState(file.name);
  const [text, setText] = useState(file.text);
  const [expanded, setExpanded] = useState(false);

  const dirty = name !== file.name || text !== file.text;

  return (
    <li className="flex flex-col gap-2 rounded-md border px-3 py-2">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Context file name"
          className="h-8 flex-1 font-medium"
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
        <Badge variant="secondary">{KIND_LABEL[file.kind]}</Badge>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatWords(textStats(text).words)}
        </span>
        <Button
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          size="sm"
          variant="ghost"
        >
          {expanded ? "Hide text" : "Show text"}
        </Button>
        <Button
          aria-label="Remove context file"
          onClick={() => void deleteContextFile(file.id)}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2Icon />
        </Button>
      </div>
      {expanded ? (
        <Textarea
          aria-label="Context file text"
          className="max-h-80 min-h-40 font-mono text-xs"
          onChange={(event) => setText(event.target.value)}
          value={text}
        />
      ) : null}
      {dirty ? (
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => {
              setName(file.name);
              setText(file.text);
            }}
            size="sm"
            variant="ghost"
          >
            Discard
          </Button>
          <Button onClick={() => void updateContextFile(file.id, name.trim(), text)} size="sm">
            Save
          </Button>
        </div>
      ) : null}
    </li>
  );
};

/** Paste or type reference text; it is stored like an imported file. */
const AddTextForm = ({ documentId }: { readonly documentId: DocumentId }) => {
  const [name, setName] = useState("");
  const [text, setText] = useState("");

  const submit = async () => {
    const trimmedName = name.trim();
    await addContextFile(documentId, {
      kind: "text",
      name: trimmedName.length > 0 ? trimmedName : "Pasted text",
      text,
    });
    setName("");
    setText("");
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="context-text-name">Add text</Label>
        <Input
          id="context-text-name"
          onChange={(event) => setName(event.target.value)}
          placeholder="Name, e.g. Board meeting notes"
          value={name}
        />
      </div>
      <Textarea
        aria-label="Context text"
        className="max-h-60 min-h-24 text-sm"
        onChange={(event) => setText(event.target.value)}
        placeholder="Paste or write the reference material here."
        value={text}
      />
      <div className="flex justify-end">
        <Button disabled={text.trim().length === 0} size="sm" type="submit">
          <PlusIcon />
          Add text
        </Button>
      </div>
    </form>
  );
};

/**
 * Import each picked file on its own so one bad file does not block the
 * rest. Conversion and storage failures are both reported per file; a
 * storage failure (quota, locked database) must not escape as a defect.
 */
const importPickedFiles = (documentId: DocumentId, files: ReadonlyArray<File>): Promise<void> =>
  runtime.runPromise(
    Effect.forEach(
      files,
      (file) =>
        importContextFile(file).pipe(
          Effect.flatMap((draft) =>
            Effect.tryPromise({
              catch: (error) =>
                new ContextImportError({
                  fileName: file.name,
                  message: `Could not save: ${error instanceof Error ? error.message : String(error)}`,
                }),
              try: () => addContextFile(documentId, draft),
            }),
          ),
          Effect.catch((error) =>
            Effect.sync(() => toast.error(`${error.fileName}: ${error.message}`)),
          ),
        ),
      { discard: true },
    ),
  );

export const ContextDialog = ({ documentId, onOpenChange, open }: ContextDialogProps) => {
  const files =
    useLiveQuery(
      () => db.contextFiles.where("documentId").equals(documentId).sortBy("createdAt"),
      [documentId],
    ) ?? [];

  const [importing, setImporting] = useState(false);

  const addFiles = async () => {
    const picked = await pickFiles(CONTEXT_FILE_ACCEPT);

    if (picked.length === 0) {
      return;
    }

    setImporting(true);

    try {
      await importPickedFiles(documentId, picked);
    } finally {
      setImporting(false);
    }
  };

  const totalWords = files.reduce((sum, file) => sum + textStats(file.text).words, 0);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Context</DialogTitle>
          <DialogDescription>
            Reference material for this document: reports, notes, sources. Sent in full with every
            pass as background; it is not part of the text.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3">
          <Button disabled={importing} onClick={() => void addFiles()} variant="outline">
            {importing ? <Loader2Icon className="animate-spin" /> : <FileUpIcon />}
            Add files…
          </Button>
          <span className="text-xs text-muted-foreground">
            PDF, Markdown, HTML, plain text.
            {files.length > 0 ? ` ${formatWords(totalWords)} attached.` : ""}
          </span>
        </div>

        {files.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No context attached.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {files.map((file) => (
              <ContextFileRow file={file} key={`${file.id}:${file.name}:${file.text.length}`} />
            ))}
          </ul>
        )}

        <AddTextForm documentId={documentId} />
      </DialogContent>
    </Dialog>
  );
};

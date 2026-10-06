import type { JSONContent } from "@tiptap/core";
import { useLiveQuery } from "dexie-react-hooks";
import { FlagIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

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
import { Switch } from "@/components/ui/switch";
import { db } from "@/db/database";
import { createRevision, deleteRevision, setRevisionMajor } from "@/db/repo";
import type { DocumentId, Revision } from "@/domain/model";
import { cn } from "@/lib/utils";

export interface RevisionsDialogProps {
  /** Snapshot source: the live editor content. */
  currentContent(): JSONContent;
  readonly documentId: DocumentId;
  onOpenChange(open: boolean): void;
  onRestore(revision: Revision): void;
  readonly open: boolean;
}

const formatTimestamp = (value: number): string =>
  new Date(value).toLocaleString(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });

const RevisionRow = ({
  onRestore,
  revision,
}: {
  onRestore(revision: Revision): void;
  readonly revision: Revision;
}) => (
  <li
    className={cn(
      "flex items-center gap-3 rounded-md border px-3 py-2",
      revision.major &&
        "border-amber-300 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-950/30",
    )}
  >
    <button
      aria-label={revision.major ? "Unflag major revision" : "Flag as major revision"}
      aria-pressed={revision.major}
      className={cn(
        "rounded p-1",
        revision.major ? "text-amber-600" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={() => void setRevisionMajor(revision.id, !revision.major)}
      title={revision.major ? "Major revision" : "Flag as major"}
      type="button"
    >
      <FlagIcon className="size-4" fill={revision.major ? "currentColor" : "none"} />
    </button>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium">
          {revision.label.length > 0 ? revision.label : "Untitled snapshot"}
        </span>
        {revision.major ? <Badge variant="secondary">Major</Badge> : null}
      </div>
      <div className="text-xs text-muted-foreground">{formatTimestamp(revision.createdAt)}</div>
    </div>
    <Button onClick={() => onRestore(revision)} size="sm" variant="outline">
      <RotateCcwIcon />
      Restore
    </Button>
    <Button
      aria-label="Delete revision"
      onClick={() => void deleteRevision(revision.id)}
      size="icon-sm"
      variant="ghost"
    >
      <Trash2Icon />
    </Button>
  </li>
);

export const RevisionsDialog = ({
  currentContent,
  documentId,
  onOpenChange,
  onRestore,
  open,
}: RevisionsDialogProps) => {
  const revisions =
    useLiveQuery(
      () => db.revisions.where("documentId").equals(documentId).reverse().sortBy("createdAt"),
      [documentId],
    ) ?? [];

  const [label, setLabel] = useState("");
  const [major, setMajor] = useState(false);

  const snapshot = async () => {
    await createRevision(documentId, currentContent(), label.trim(), major);
    setLabel("");
    setMajor(false);
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Revisions</DialogTitle>
          <DialogDescription>
            Snapshots of this document. Flag the ones that mark a major change of direction.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex items-end gap-3 rounded-md border bg-muted/40 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void snapshot();
          }}
        >
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="revision-label">Label</Label>
            <Input
              id="revision-label"
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. After structure pass"
              value={label}
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch checked={major} id="revision-major" onCheckedChange={setMajor} />
            <Label htmlFor="revision-major">Major</Label>
          </div>
          <Button type="submit">Save snapshot</Button>
        </form>

        {revisions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No snapshots yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {revisions.map((revision) => (
              <RevisionRow key={revision.id} onRestore={onRestore} revision={revision} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
};

import type { JSONContent } from "@tiptap/core";
import { diffWordsWithSpace } from "diff";
import { useMemo, useState } from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Revision, RevisionId } from "@/domain/model";
import { contentToMarkdown } from "@/editor/markdown";

/** Sentinel option value meaning "the live working copy". */
const CURRENT = "current";

export interface RevisionCompareProps {
  currentContent(): JSONContent;
  readonly revisions: ReadonlyArray<Revision>;
  /** Revision opened from the list; the comparison starts from it. */
  readonly selected: Revision;
}

const formatTimestamp = (value: number): string =>
  new Date(value).toLocaleString(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });

const revisionLabel = (revision: Revision): string =>
  `${revision.label.length > 0 ? revision.label : "Untitled snapshot"} · ${formatTimestamp(revision.createdAt)}`;

interface DiffViewProps {
  readonly after: string;
  readonly before: string;
}

/**
 * Word-level inline diff of two Markdown renderings. Markdown keeps block
 * structure (headings, lists) visible while staying plain text.
 */
const DiffView = ({ after, before }: DiffViewProps) => {
  const changes = useMemo(() => diffWordsWithSpace(before, after), [after, before]);
  const unchanged = changes.every((change) => !change.added && !change.removed);

  if (unchanged) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No differences.</p>;
  }

  return (
    <pre className="max-h-[50vh] overflow-y-auto rounded-md border bg-muted/30 p-4 font-serif text-sm leading-relaxed whitespace-pre-wrap">
      {changes.map((change, index) => {
        if (change.added) {
          return (
            <ins
              className="rounded-sm bg-emerald-100 no-underline dark:bg-emerald-900/50"
              key={index}
            >
              {change.value}
            </ins>
          );
        }

        if (change.removed) {
          return (
            <del
              className="rounded-sm bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
              key={index}
            >
              {change.value}
            </del>
          );
        }

        return <span key={index}>{change.value}</span>;
      })}
    </pre>
  );
};

export const RevisionCompare = ({ currentContent, revisions, selected }: RevisionCompareProps) => {
  const [againstId, setAgainstId] = useState<RevisionId | typeof CURRENT>(CURRENT);
  const [mode, setMode] = useState<"diff" | "view">("diff");

  const against = revisions.find((revision) => revision.id === againstId) ?? null;
  const before = useMemo(() => contentToMarkdown(selected.content), [selected]);

  const after = useMemo(
    () =>
      against === null ? contentToMarkdown(currentContent()) : contentToMarkdown(against.content),
    [against, currentContent],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label>From</Label>
          <div className="h-8 rounded-md border px-3 text-sm leading-8">
            {revisionLabel(selected)}
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="compare-against">To</Label>
          <Select
            onValueChange={(value) => {
              // SAFETY: option values are CURRENT or RevisionIds rendered below.
              setAgainstId(value as RevisionId | typeof CURRENT);
            }}
            value={againstId}
          >
            <SelectTrigger className="h-8 w-64" id="compare-against" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CURRENT}>Current working copy</SelectItem>
              {revisions
                .filter((revision) => revision.id !== selected.id)
                .map((revision) => (
                  <SelectItem key={revision.id} value={revision.id}>
                    {revisionLabel(revision)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-1 text-xs">
          <button
            className={
              mode === "diff" ? "rounded-md bg-accent px-2 py-1" : "px-2 py-1 text-muted-foreground"
            }
            onClick={() => setMode("diff")}
            type="button"
          >
            Changes
          </button>
          <button
            className={
              mode === "view" ? "rounded-md bg-accent px-2 py-1" : "px-2 py-1 text-muted-foreground"
            }
            onClick={() => setMode("view")}
            type="button"
          >
            Read snapshot
          </button>
        </div>
      </div>
      {mode === "diff" ? (
        <DiffView after={after} before={before} />
      ) : (
        <pre className="max-h-[50vh] overflow-y-auto rounded-md border bg-muted/30 p-4 font-serif text-sm leading-relaxed whitespace-pre-wrap">
          {before}
        </pre>
      )}
    </div>
  );
};

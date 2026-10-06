import {
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  HistoryIcon,
  Loader2Icon,
  PlayIcon,
  TextSelectIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Pass, PassPrompt, PassPromptId } from "@/domain/model";
import type { TextRange } from "@/domain/textIndex";
import type { PassRunner } from "@/hooks/usePassRunner";
import { cn } from "@/lib/utils";

export interface PassToolbarProps {
  readonly activeIndex: number;
  onDeletePass(pass: Pass): void;
  onExportMarkdown(): void;
  onNext(): void;
  onOpenRevisions(): void;
  onPrevious(): void;
  onTogglePass(pass: Pass): void;
  readonly openCount: number;
  readonly passes: ReadonlyArray<Pass>;
  readonly prompts: ReadonlyArray<PassPrompt>;
  readonly runner: PassRunner;
  /** Current editor selection when it is non-empty; the pass runs on it. */
  readonly selection: TextRange | null;
}

export const PassToolbar = ({
  activeIndex,
  onDeletePass,
  onExportMarkdown,
  onNext,
  onOpenRevisions,
  onPrevious,
  onTogglePass,
  openCount,
  passes,
  prompts,
  runner,
  selection,
}: PassToolbarProps) => {
  const [selectedId, setSelectedId] = useState<PassPromptId | null>(null);
  // Fall back to the first prompt when nothing is chosen or the choice was deleted.
  const selected = prompts.find((prompt) => prompt.id === selectedId) ?? prompts[0] ?? null;
  const hasOpen = openCount > 0;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
      <Select
        onValueChange={(value) => {
          // SAFETY: option values are rendered from PassPrompt ids only.
          setSelectedId(value as PassPromptId);
        }}
        value={selected?.id ?? ""}
      >
        <SelectTrigger aria-label="Pass" className="h-8 w-44" size="sm">
          <SelectValue placeholder="Choose a pass" />
        </SelectTrigger>
        <SelectContent>
          {prompts.map((prompt) => (
            <SelectItem key={prompt.id} value={prompt.id}>
              {prompt.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {runner.running === null ? (
        <Button
          disabled={selected === null}
          onClick={() => {
            if (selected !== null) {
              void runner.run(selected, selection);
            }
          }}
          size="sm"
          title={
            selection === null
              ? "Run on the whole document"
              : "Run on the selected text only. Clear the selection to run on everything."
          }
        >
          {selection === null ? <PlayIcon /> : <TextSelectIcon />}
          {selection === null ? "Run pass" : "Run on selection"}
        </Button>
      ) : (
        <Button onClick={runner.cancel} size="sm" variant="outline">
          <Loader2Icon className="animate-spin" />
          {runner.running.promptName}…
          <XIcon />
        </Button>
      )}

      <div className="mx-1 h-5 w-px bg-border" />

      <div className="flex items-center gap-1">
        <Button
          aria-label="Previous note"
          disabled={!hasOpen}
          onClick={onPrevious}
          size="icon-sm"
          title="Previous note (Alt+↑)"
          variant="ghost"
        >
          <ChevronUpIcon />
        </Button>
        <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground">
          {hasOpen ? `${activeIndex + 1} / ${openCount}` : "0 notes"}
        </span>
        <Button
          aria-label="Next note"
          disabled={!hasOpen}
          onClick={onNext}
          size="icon-sm"
          title="Next note (Alt+↓)"
          variant="ghost"
        >
          <ChevronDownIcon />
        </Button>
      </div>

      {passes.length > 0 ? <div className="mx-1 h-5 w-px bg-border" /> : null}

      <div className="flex flex-wrap items-center gap-1">
        {passes.map((pass) => (
          <span
            className={cn(
              "commentary-tone-badge inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
              pass.hidden && "opacity-50",
            )}
            data-tone={pass.tone}
            key={pass.id}
            title={pass.error ?? pass.status}
          >
            <button
              aria-label={`${pass.hidden ? "Show" : "Hide"} ${pass.promptName} pass`}
              aria-pressed={!pass.hidden}
              className="inline-flex items-center gap-1"
              onClick={() => onTogglePass(pass)}
              type="button"
            >
              {pass.hidden ? <EyeOffIcon className="size-3" /> : <EyeIcon className="size-3" />}
              {pass.promptName}
            </button>
            {pass.status === "running" ? <Loader2Icon className="size-3 animate-spin" /> : null}
            {pass.status === "error" ? <span className="text-destructive">!</span> : null}
            <button
              aria-label={`Remove ${pass.promptName} pass`}
              className="rounded-sm opacity-60 hover:opacity-100"
              onClick={() => onDeletePass(pass)}
              type="button"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button onClick={onExportMarkdown} size="sm" title="Download as Markdown" variant="ghost">
          <DownloadIcon />
          Export
        </Button>
        <Button onClick={onOpenRevisions} size="sm" variant="ghost">
          <HistoryIcon />
          Revisions
        </Button>
      </div>
    </div>
  );
};

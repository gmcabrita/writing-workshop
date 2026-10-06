import {
  ChevronDownIcon,
  ChevronUpIcon,
  HistoryIcon,
  Loader2Icon,
  PlayIcon,
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
import type { PassRunner } from "@/hooks/usePassRunner";

export interface PassToolbarProps {
  readonly activeIndex: number;
  onDeletePass(pass: Pass): void;
  onNext(): void;
  onOpenRevisions(): void;
  onPrevious(): void;
  readonly openCount: number;
  readonly passes: ReadonlyArray<Pass>;
  readonly prompts: ReadonlyArray<PassPrompt>;
  readonly runner: PassRunner;
}

export const PassToolbar = ({
  activeIndex,
  onDeletePass,
  onNext,
  onOpenRevisions,
  onPrevious,
  openCount,
  passes,
  prompts,
  runner,
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
              void runner.run(selected);
            }
          }}
          size="sm"
        >
          <PlayIcon />
          Run pass
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
            className="commentary-tone-badge inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
            data-tone={pass.tone}
            key={pass.id}
            title={pass.error ?? pass.status}
          >
            {pass.promptName}
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

      <div className="ml-auto">
        <Button onClick={onOpenRevisions} size="sm" variant="ghost">
          <HistoryIcon />
          Revisions
        </Button>
      </div>
    </div>
  );
};

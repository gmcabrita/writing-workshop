import type { Editor } from "@tiptap/core";
import { CheckIcon, MapPinIcon, Trash2Icon, XIcon } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type LayoutItem, layoutCommentary } from "@/domain/commentaryLayout";
import {
  MANUAL_PASS_ID,
  type Pass,
  type PassId,
  type Suggestion,
  type SuggestionId,
} from "@/domain/model";
import { cn } from "@/lib/utils";

/** Vertical space between stacked cards. */
const CARD_GAP = 8;

/** Used before a card has been measured. */
const ESTIMATED_CARD_HEIGHT = 120;

export interface CommentaryPanelProps {
  readonly activeId: SuggestionId | null;
  readonly editor: Editor | null;
  onAccept(suggestion: Suggestion): void;
  onCommentChange(id: SuggestionId, comment: string): void;
  onDelete(suggestion: Suggestion): void;
  onDismiss(suggestion: Suggestion): void;
  onPlace(suggestion: Suggestion): void;
  onSelect(id: SuggestionId): void;
  readonly passes: ReadonlyMap<PassId, Pass>;
  /** Notes with a highlight, in document order. */
  readonly suggestions: ReadonlyArray<Suggestion>;
  /** Open notes with no highlight: quote not found, or the text was deleted. */
  readonly unplaced: ReadonlyArray<Suggestion>;
}

type AnchorMap = ReadonlyMap<SuggestionId, number>;

/**
 * Measure where each suggestion's first highlight sits, relative to the
 * panel's top edge. Panel and prose share a scroll container, so the
 * difference of their client rects is scroll-independent. Suggestions with
 * no highlight in the document (text deleted) are omitted.
 */
const measureAnchors = (
  editor: Editor,
  panel: HTMLElement,
  suggestions: ReadonlyArray<Suggestion>,
): AnchorMap => {
  const panelTop = panel.getBoundingClientRect().top;
  const anchors = new Map<SuggestionId, number>();

  for (const suggestion of suggestions) {
    const element = editor.view.dom.querySelector(`[data-suggestion-id="${suggestion.id}"]`);

    if (element !== null) {
      anchors.set(suggestion.id, element.getBoundingClientRect().top - panelTop);
    }
  }

  return anchors;
};

interface CardActionsProps {
  onAccept(suggestion: Suggestion): void;
  onDismiss(suggestion: Suggestion): void;
  /** Present for unplaced notes: attach the note to the current selection. */
  onPlace: ((suggestion: Suggestion) => void) | null;
  readonly suggestion: Suggestion;
}

const CardActions = ({ onAccept, onDismiss, onPlace, suggestion }: CardActionsProps) => (
  <div className="mt-3 flex items-center gap-1.5">
    {onPlace === null ? (
      <Button
        onClick={(event) => {
          event.stopPropagation();
          onAccept(suggestion);
        }}
        size="xs"
        variant="default"
      >
        <CheckIcon />
        {suggestion.replacement === null ? "Resolve" : "Accept"}
      </Button>
    ) : (
      <Button
        onClick={(event) => {
          event.stopPropagation();
          onPlace(suggestion);
        }}
        size="xs"
        title="Select the passage in the text first"
        variant="default"
      >
        <MapPinIcon />
        Place at selection
      </Button>
    )}
    <Button
      onClick={(event) => {
        event.stopPropagation();
        onDismiss(suggestion);
      }}
      size="xs"
      variant="ghost"
    >
      <XIcon />
      Dismiss
    </Button>
  </div>
);

const ReplacementPreview = ({ replacement }: { readonly replacement: string }) => (
  <div className="mt-2 rounded-md bg-muted/60 p-2 text-xs">
    <div className="mb-1 font-medium text-muted-foreground">Suggested</div>
    <div className="whitespace-pre-wrap">
      {replacement.length === 0 ? <em>(delete)</em> : replacement}
    </div>
  </div>
);

interface CardBodyProps {
  readonly active: boolean;
  readonly isManual: boolean;
  onCommentChange(id: SuggestionId, comment: string): void;
  readonly suggestion: Suggestion;
}

const CardBody = ({ active, isManual, onCommentChange, suggestion }: CardBodyProps) => {
  if (isManual) {
    return (
      <Textarea
        className="min-h-16 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
        onChange={(event) => onCommentChange(suggestion.id, event.target.value)}
        onClick={(event) => event.stopPropagation()}
        placeholder="Write your note…"
        value={suggestion.comment}
      />
    );
  }

  return (
    <>
      {active ? (
        <blockquote className="mb-2 border-l-2 pl-2 text-xs text-muted-foreground italic">
          {suggestion.quote}
        </blockquote>
      ) : null}
      <p className={cn("leading-snug whitespace-pre-wrap", !active && "line-clamp-3")}>
        {suggestion.comment}
      </p>
      {active && suggestion.replacement !== null ? (
        <ReplacementPreview replacement={suggestion.replacement} />
      ) : null}
    </>
  );
};

interface CommentaryCardProps {
  readonly active: boolean;
  onAccept(suggestion: Suggestion): void;
  onCommentChange(id: SuggestionId, comment: string): void;
  onDelete(suggestion: Suggestion): void;
  onDismiss(suggestion: Suggestion): void;
  onMeasure(id: SuggestionId, height: number): void;
  onPlace: ((suggestion: Suggestion) => void) | null;
  onSelect(id: SuggestionId): void;
  readonly pass: Pass | undefined;
  readonly suggestion: Suggestion;
  /** Pixel offset for pinned cards; null renders the card in normal flow. */
  readonly top: number | null;
}

const CommentaryCard = ({
  active,
  onAccept,
  onCommentChange,
  onDelete,
  onDismiss,
  onMeasure,
  onPlace,
  onSelect,
  pass,
  suggestion,
  top,
}: CommentaryCardProps) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const isManual = suggestion.passId === MANUAL_PASS_ID;
  const tone = pass?.tone ?? 0;

  useLayoutEffect(() => {
    const element = ref.current;

    if (element === null) {
      return;
    }

    const observer = new ResizeObserver(() => onMeasure(suggestion.id, element.offsetHeight));
    observer.observe(element);

    return () => observer.disconnect();
  }, [onMeasure, suggestion.id]);

  return (
    <div
      className={cn(
        "commentary-card rounded-lg border bg-card p-3 text-sm shadow-xs transition-[top,box-shadow] duration-200",
        top === null ? "relative" : "absolute right-0 left-0",
        active ? "z-10 shadow-md" : "cursor-pointer opacity-80 hover:opacity-100",
      )}
      data-active={active}
      data-tone={tone}
      onClick={() => onSelect(suggestion.id)}
      ref={ref}
      style={top === null ? undefined : { top }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span
          className="commentary-tone-badge rounded px-1.5 py-0.5 text-[11px] font-medium"
          data-tone={tone}
        >
          {isManual ? "Note" : (pass?.promptName ?? "Pass")}
        </span>
        <button
          aria-label="Delete note"
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(suggestion);
          }}
          title="Delete note"
          type="button"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>
      <CardBody
        active={active}
        isManual={isManual}
        onCommentChange={onCommentChange}
        suggestion={suggestion}
      />
      {active ? (
        <CardActions
          onAccept={onAccept}
          onDismiss={onDismiss}
          onPlace={onPlace}
          suggestion={suggestion}
        />
      ) : null}
    </div>
  );
};

/**
 * Keeps `anchors` in sync with where highlights are drawn. Measurement is
 * scheduled on an animation frame so layout has settled after each change.
 */
const useHighlightAnchors = (
  editor: Editor | null,
  panel: RefObject<HTMLDivElement | null>,
  suggestions: ReadonlyArray<Suggestion>,
): AnchorMap => {
  const [anchors, setAnchors] = useState<AnchorMap>(new Map());

  useEffect(() => {
    if (editor === null) {
      return;
    }

    let frame: number | null = null;

    const schedule = () => {
      if (frame !== null) {
        return;
      }

      frame = requestAnimationFrame(() => {
        frame = null;
        const element = panel.current;

        if (element !== null) {
          setAnchors(measureAnchors(editor, element, suggestions));
        }
      });
    };

    schedule();
    editor.on("transaction", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(editor.view.dom);
    window.addEventListener("resize", schedule);

    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }

      editor.off("transaction", schedule);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [editor, panel, suggestions]);

  return anchors;
};

export const CommentaryPanel = ({
  activeId,
  editor,
  onAccept,
  onCommentChange,
  onDelete,
  onDismiss,
  onPlace,
  onSelect,
  passes,
  suggestions,
  unplaced,
}: CommentaryPanelProps) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const anchors = useHighlightAnchors(editor, panelRef, suggestions);
  const [heights, setHeights] = useState<ReadonlyMap<SuggestionId, number>>(new Map());

  const onMeasure = useCallback((id: SuggestionId, height: number) => {
    setHeights((current) => {
      if (current.get(id) === height) {
        return current;
      }

      const next = new Map(current);
      next.set(id, height);

      return next;
    });
  }, []);

  const placed = useMemo(() => {
    const items: Array<LayoutItem<SuggestionId>> = [];

    for (const suggestion of suggestions) {
      const anchorTop = anchors.get(suggestion.id);

      if (anchorTop !== undefined) {
        items.push({
          anchorTop,
          height: heights.get(suggestion.id) ?? ESTIMATED_CARD_HEIGHT,
          id: suggestion.id,
        });
      }
    }

    return layoutCommentary(items, activeId, CARD_GAP);
  }, [activeId, anchors, heights, suggestions]);

  const topById = useMemo(() => new Map(placed.map((item) => [item.id, item.top])), [placed]);

  const panelHeight = placed.reduce(
    (max, item) => Math.max(max, item.top + (heights.get(item.id) ?? ESTIMATED_CARD_HEIGHT)),
    0,
  );

  return (
    <>
      <div className="relative" ref={panelRef} style={{ minHeight: panelHeight + CARD_GAP }}>
        {suggestions.length === 0 && unplaced.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">
            No open notes. Run a pass or select text and choose “Annotate”.
          </p>
        ) : null}
        {suggestions.map((suggestion) => {
          const top = topById.get(suggestion.id);

          if (top === undefined) {
            return null;
          }

          return (
            <CommentaryCard
              active={suggestion.id === activeId}
              key={suggestion.id}
              onAccept={onAccept}
              onCommentChange={onCommentChange}
              onDelete={onDelete}
              onDismiss={onDismiss}
              onMeasure={onMeasure}
              onPlace={null}
              onSelect={onSelect}
              pass={passes.get(suggestion.passId)}
              suggestion={suggestion}
              top={top}
            />
          );
        })}
      </div>
      {unplaced.length > 0 ? (
        <section className="mt-6 flex flex-col gap-2">
          <h3 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Unplaced ({unplaced.length})
          </h3>
          <p className="px-1 text-xs text-muted-foreground">
            The quoted text was not found. Select the passage it refers to, then place it.
          </p>
          {unplaced.map((suggestion) => (
            <CommentaryCard
              active={suggestion.id === activeId}
              key={suggestion.id}
              onAccept={onAccept}
              onCommentChange={onCommentChange}
              onDelete={onDelete}
              onDismiss={onDismiss}
              onMeasure={onMeasure}
              onPlace={onPlace}
              onSelect={onSelect}
              pass={passes.get(suggestion.passId)}
              suggestion={suggestion}
              top={null}
            />
          ))}
        </section>
      ) : null}
    </>
  );
};

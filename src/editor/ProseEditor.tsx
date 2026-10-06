import type { Editor, JSONContent } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import Typography from "@tiptap/extension-typography";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import {
  BoldIcon,
  CodeIcon,
  Highlighter,
  ItalicIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { SlashCommand } from "@/editor/SlashCommand";
import { SuggestionMark, suggestionIdsAt } from "@/editor/SuggestionMark";
import type { SuggestionId } from "@/domain/model";
import type { TextRange } from "@/domain/textIndex";
import { cn } from "@/lib/utils";

/** Milliseconds of inactivity before the working copy is persisted. */
const SAVE_DEBOUNCE_MS = 400;

export interface ProseEditorProps {
  readonly initialContent: JSONContent;
  /** Called when the writer asks to annotate the current selection. */
  onAnnotate(range: TextRange, quote: string): void;
  onChange(content: JSONContent): void;
  onReady(editor: Editor | null): void;
  /** Highlights under the click, shortest span first. */
  onSuggestionClick(ids: ReadonlyArray<SuggestionId>): void;
}

interface ToolbarButtonProps {
  readonly active: boolean;
  readonly icon: typeof BoldIcon;
  readonly label: string;
  onClick(): void;
}

const ToolbarButton = ({ active, icon: Icon, label, onClick }: ToolbarButtonProps) => (
  <button
    aria-label={label}
    aria-pressed={active}
    className={cn(
      "flex size-7 items-center justify-center rounded-md text-foreground/80 hover:bg-accent",
      active && "bg-accent text-foreground",
    )}
    onMouseDown={(event) => {
      // Keep the editor selection; a normal click would blur it.
      event.preventDefault();
      onClick();
    }}
    title={label}
    type="button"
  >
    <Icon className="size-4" />
  </button>
);

/**
 * The prose surface. Content is uncontrolled after mount; callers remount
 * (via `key`) when switching documents so the editor starts from scratch.
 */
export const ProseEditor = ({
  initialContent,
  onAnnotate,
  onChange,
  onReady,
  onSuggestionClick,
}: ProseEditorProps) => {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // editorProps are captured once when the editor is created, so the click
  // handler reads the latest callback through a ref.
  const suggestionClickRef = useRef(onSuggestionClick);

  useEffect(() => {
    suggestionClickRef.current = onSuggestionClick;
  }, [onSuggestionClick]);

  const editor = useEditor({
    content: initialContent,
    editorProps: {
      attributes: {
        class: "prose-editor focus:outline-none",
        spellcheck: "true",
      },
      // A raw DOM listener rather than handleClick: ProseMirror skips
      // handleClick when the click does not move the selection, which is
      // exactly the repeated click used to cycle through stacked highlights.
      handleDOMEvents: {
        click: (view, event) => {
          const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });

          if (hit === null) {
            return false;
          }

          const ids = suggestionIdsAt(view.state.doc, hit.pos);

          if (ids.length > 0) {
            suggestionClickRef.current(ids);
          }

          return false;
        },
      },
    },
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false },
      }),
      Typography,
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "heading" ? "Heading" : "Write, or type “/” for blocks…",
      }),
      SuggestionMark,
      SlashCommand,
    ],
    onUpdate: ({ editor: current }) => {
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current);
      }

      saveTimer.current = setTimeout(() => onChange(current.getJSON()), SAVE_DEBOUNCE_MS);
    },
  });

  useEffect(() => {
    onReady(editor);

    return () => onReady(null);
  }, [editor, onReady]);

  useEffect(
    () => () => {
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current);
      }
    },
    [],
  );

  if (editor === null) {
    return null;
  }

  const annotateSelection = () => {
    const { from, to } = editor.state.selection;

    if (from === to) {
      return;
    }

    onAnnotate({ from, to }, editor.state.doc.textBetween(from, to, "\n"));
  };

  return (
    <>
      <BubbleMenu
        className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-md"
        editor={editor}
        options={{ offset: 8, placement: "top" }}
        shouldShow={({ state }) => !state.selection.empty && state.selection.content().size > 0}
      >
        <ToolbarButton
          active={editor.isActive("bold")}
          icon={BoldIcon}
          label="Bold"
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          active={editor.isActive("italic")}
          icon={ItalicIcon}
          label="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          active={editor.isActive("underline")}
          icon={UnderlineIcon}
          label="Underline"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <ToolbarButton
          active={editor.isActive("strike")}
          icon={StrikethroughIcon}
          label="Strikethrough"
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
        <ToolbarButton
          active={editor.isActive("code")}
          icon={CodeIcon}
          label="Inline code"
          onClick={() => editor.chain().focus().toggleCode().run()}
        />
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton
          active={false}
          icon={Highlighter}
          label="Annotate selection"
          onClick={annotateSelection}
        />
      </BubbleMenu>
      <EditorContent editor={editor} />
    </>
  );
};

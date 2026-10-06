import { type Editor, Extension, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import {
  Code2Icon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  type LucideIcon,
  MinusIcon,
  PilcrowIcon,
  TextQuoteIcon,
} from "lucide-react";
import { forwardRef, useImperativeHandle, useState } from "react";

import { cn } from "@/lib/utils";

export interface SlashCommandItem {
  readonly description: string;
  readonly icon: LucideIcon;
  readonly keywords: ReadonlyArray<string>;
  run(editor: Editor, range: Range): void;
  readonly title: string;
}

const SLASH_COMMANDS: ReadonlyArray<SlashCommandItem> = [
  {
    description: "Plain paragraph",
    icon: PilcrowIcon,
    keywords: ["paragraph", "p", "body"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run(),
    title: "Text",
  },
  {
    description: "Large section heading",
    icon: Heading1Icon,
    keywords: ["h1", "title"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
    title: "Heading 1",
  },
  {
    description: "Medium section heading",
    icon: Heading2Icon,
    keywords: ["h2", "subtitle"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
    title: "Heading 2",
  },
  {
    description: "Small section heading",
    icon: Heading3Icon,
    keywords: ["h3"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
    title: "Heading 3",
  },
  {
    description: "Simple bulleted list",
    icon: ListIcon,
    keywords: ["ul", "bullets", "unordered"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    title: "Bulleted list",
  },
  {
    description: "List with numbers",
    icon: ListOrderedIcon,
    keywords: ["ol", "numbers", "ordered"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    title: "Numbered list",
  },
  {
    description: "Capture a quotation",
    icon: TextQuoteIcon,
    keywords: ["blockquote", "citation"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    title: "Quote",
  },
  {
    description: "Monospace block",
    icon: Code2Icon,
    keywords: ["code", "pre"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
    title: "Code block",
  },
  {
    description: "Horizontal rule",
    icon: MinusIcon,
    keywords: ["hr", "rule", "break"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    title: "Divider",
  },
];

const filterCommands = (query: string): Array<SlashCommandItem> => {
  const needle = query.toLowerCase().trim();

  if (needle.length === 0) {
    return [...SLASH_COMMANDS];
  }

  return SLASH_COMMANDS.filter(
    (item) =>
      item.title.toLowerCase().includes(needle) ||
      item.keywords.some((keyword) => keyword.includes(needle)),
  );
};

interface SlashMenuProps {
  command(item: SlashCommandItem): void;
  readonly items: ReadonlyArray<SlashCommandItem>;
}

export interface SlashMenuHandle {
  onKeyDown(props: SuggestionKeyDownProps): boolean;
}

const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(({ command, items }, ref) => {
  const [selected, setSelected] = useState(0);
  const [seenItems, setSeenItems] = useState(items);

  // Reset the cursor when the filtered list changes (derived during render).
  if (items !== seenItems) {
    setSeenItems(items);
    setSelected(0);
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setSelected((current) => (current + items.length - 1) % Math.max(items.length, 1));

        return true;
      }

      if (event.key === "ArrowDown") {
        setSelected((current) => (current + 1) % Math.max(items.length, 1));

        return true;
      }

      if (event.key === "Enter") {
        const item = items[selected];

        if (item !== undefined) {
          command(item);
        }

        return true;
      }

      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="w-72 rounded-lg border bg-popover p-2 text-sm text-muted-foreground shadow-md">
        No matching blocks
      </div>
    );
  }

  return (
    <div className="w-72 overflow-hidden rounded-lg border bg-popover p-1 shadow-md">
      {items.map((item, index) => (
        <button
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm",
            index === selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
          )}
          key={item.title}
          onClick={() => command(item)}
          onMouseEnter={() => setSelected(index)}
          type="button"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
            <item.icon className="size-4" />
          </span>
          <span className="flex flex-col">
            <span className="font-medium">{item.title}</span>
            <span className="text-xs text-muted-foreground">{item.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
});

SlashMenu.displayName = "SlashMenu";

/** Notion-style "/" menu for inserting block types. */
export const SlashCommand = Extension.create({
  addProseMirrorPlugins() {
    let renderer: ReactRenderer<SlashMenuHandle, SlashMenuProps> | null = null;
    let unmount: (() => void) | null = null;

    return [
      Suggestion<SlashCommandItem, SlashCommandItem>({
        char: "/",
        command: ({ editor, props, range }) => props.run(editor, range),
        editor: this.editor,
        items: ({ query }) => filterCommands(query),
        render: () => ({
          onExit: () => {
            unmount?.();
            renderer?.destroy();
            renderer = null;
            unmount = null;
          },
          onKeyDown: (props) => {
            if (props.event.key === "Escape") {
              unmount?.();
              renderer?.destroy();
              renderer = null;
              unmount = null;

              return true;
            }

            return renderer?.ref?.onKeyDown(props) ?? false;
          },
          onStart: (props: SuggestionProps<SlashCommandItem, SlashCommandItem>) => {
            renderer = new ReactRenderer(SlashMenu, {
              editor: props.editor,
              props: { command: props.command, items: props.items },
            });
            unmount = props.mount(renderer.element);
          },
          onUpdate: (props) => {
            renderer?.updateProps({ command: props.command, items: props.items });
          },
        }),
        startOfLine: false,
      }),
    ];
  },

  name: "slashCommand",
});

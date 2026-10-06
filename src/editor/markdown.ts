import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

import { SuggestionMark } from "@/editor/SuggestionMark";

/**
 * Headless Markdown converter sharing the editor's schema. Used for import
 * and export without an editor instance on screen. Suggestion highlights
 * have no Markdown form and are dropped on export.
 */
const manager = new MarkdownManager({
  extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), SuggestionMark],
});

export const markdownToContent = (markdown: string): JSONContent => manager.parse(markdown);

export const contentToMarkdown = (content: JSONContent): string => manager.serialize(content);

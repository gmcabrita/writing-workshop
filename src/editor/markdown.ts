import { type Extensions, generateJSON, type JSONContent } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

import { SuggestionMark } from "@/editor/SuggestionMark";

/**
 * Headless Markdown converter sharing the editor's schema. Used for import
 * and export without an editor instance on screen. Suggestion highlights
 * have no Markdown form and are dropped on export.
 */
const extensions: Extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  SuggestionMark,
];

const manager = new MarkdownManager({ extensions });

export const markdownToContent = (markdown: string): JSONContent => manager.parse(markdown);

export const contentToMarkdown = (content: JSONContent): string => manager.serialize(content);

/**
 * Reference HTML (reports, articles) often carries tables the editor does
 * not support. The converter adds table nodes so cells keep their
 * boundaries and come out as GFM pipe tables.
 */
const htmlExtensions: Extensions = [...extensions, TableKit];

const htmlManager = new MarkdownManager({ extensions: htmlExtensions });

/**
 * HTML to Markdown through the editor schema plus tables: elements the
 * schema knows (headings, lists, emphasis, links, code, tables) survive,
 * everything else collapses to its text. Scripts and styles are dropped by
 * the parser.
 */
export const htmlToMarkdown = (html: string): string =>
  htmlManager.serialize(generateJSON(html, htmlExtensions));

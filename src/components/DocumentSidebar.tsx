import {
  DownloadIcon,
  FileTextIcon,
  FileUpIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DocumentId, WorkshopDocument } from "@/domain/model";
import { cn } from "@/lib/utils";

export interface DocumentSidebarProps {
  readonly activeId: DocumentId | null;
  readonly documents: ReadonlyArray<WorkshopDocument>;
  onCreate(): void;
  onDelete(id: DocumentId): void;
  onExportBackup(): void;
  onImportBackup(): void;
  onImportMarkdown(): void;
  onOpenSettings(): void;
  onSelect(id: DocumentId): void;
}

export const DocumentSidebar = ({
  activeId,
  documents,
  onCreate,
  onDelete,
  onExportBackup,
  onImportBackup,
  onImportMarkdown,
  onOpenSettings,
  onSelect,
}: DocumentSidebarProps) => (
  <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
    <div className="flex items-center justify-between px-3 py-3">
      <span className="text-sm font-semibold tracking-tight">Workshop</span>
      <Button aria-label="New document" onClick={onCreate} size="icon-sm" variant="ghost">
        <PlusIcon />
      </Button>
    </div>
    <nav className="flex-1 overflow-y-auto px-2">
      {documents.length === 0 ? (
        <p className="px-2 py-4 text-xs text-muted-foreground">No documents yet.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {documents.map((document) => (
            <li className="group relative" key={document.id}>
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  document.id === activeId
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/60",
                )}
                onClick={() => onSelect(document.id)}
                type="button"
              >
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {document.title.length > 0 ? document.title : "Untitled"}
                </span>
              </button>
              <button
                aria-label="Delete document"
                className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive group-hover:block"
                onClick={() => onDelete(document.id)}
                type="button"
              >
                <Trash2Icon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
    <div className="flex flex-col gap-0.5 border-t p-2">
      <Button className="w-full justify-start" onClick={onImportMarkdown} size="sm" variant="ghost">
        <FileUpIcon />
        Import Markdown…
      </Button>
      <Button className="w-full justify-start" onClick={onExportBackup} size="sm" variant="ghost">
        <DownloadIcon />
        Back up everything
      </Button>
      <Button className="w-full justify-start" onClick={onImportBackup} size="sm" variant="ghost">
        <UploadIcon />
        Restore backup…
      </Button>
      <Button className="w-full justify-start" onClick={onOpenSettings} size="sm" variant="ghost">
        <SettingsIcon />
        Settings
      </Button>
    </div>
  </aside>
);

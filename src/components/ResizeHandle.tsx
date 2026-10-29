import type { PointerEvent as ReactPointerEvent } from "react";

import { cn } from "@/lib/utils";

export interface ResizeHandleProps {
  readonly active: boolean;
  readonly className?: string;
  readonly label: string;
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
}

/**
 * Thin vertical drag strip between two panels. The line shows on hover and
 * while dragging; the hit area is wider so it is easy to grab.
 */
export const ResizeHandle = ({ active, className, label, onPointerDown }: ResizeHandleProps) => (
  <div
    aria-label={label}
    aria-orientation="vertical"
    className={cn(
      "group relative w-2 shrink-0 cursor-col-resize touch-none select-none",
      "after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-ring after:opacity-0 after:transition-opacity",
      "hover:after:opacity-100",
      active && "after:opacity-100",
      className,
    )}
    onPointerDown={onPointerDown}
    role="separator"
  />
);

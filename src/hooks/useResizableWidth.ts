import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useState } from "react";

export interface ResizableWidthOptions {
  readonly defaultWidth: number;
  readonly maxWidth: number;
  readonly minWidth: number;
  /**
   * Which edge of the panel the drag handle sits on. Dragging the handle
   * right grows a panel whose handle is on its right edge and shrinks one
   * whose handle is on its left edge.
   */
  readonly side: "left" | "right";
  /** localStorage key. The width survives reloads. */
  readonly storageKey: string;
}

export interface ResizableWidth {
  /** Attach to the drag handle's `onPointerDown`. */
  onHandlePointerDown(event: ReactPointerEvent<HTMLElement>): void;
  /** True while the pointer is held on the handle. */
  readonly resizing: boolean;
  readonly width: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const readStoredWidth = (key: string, fallback: number, min: number, max: number): number => {
  const parsed = Number(localStorage.getItem(key));

  return Number.isFinite(parsed) && parsed > 0 ? clamp(parsed, min, max) : fallback;
};

/**
 * Width of a panel the user can drag to resize. Tracking uses pointer
 * capture on the handle, so the drag keeps working when the pointer leaves
 * the handle or the window.
 */
export const useResizableWidth = ({
  defaultWidth,
  maxWidth,
  minWidth,
  side,
  storageKey,
}: ResizableWidthOptions): ResizableWidth => {
  const [width, setWidth] = useState(() =>
    readStoredWidth(storageKey, defaultWidth, minWidth, maxWidth),
  );

  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      const handle = event.currentTarget;
      const startX = event.clientX;
      const startWidth = width;
      const direction = side === "right" ? 1 : -1;
      handle.setPointerCapture(event.pointerId);
      setResizing(true);

      const onMove = (move: PointerEvent) => {
        setWidth(clamp(startWidth + (move.clientX - startX) * direction, minWidth, maxWidth));
      };

      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        setResizing(false);
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [maxWidth, minWidth, side, width],
  );

  return { onHandlePointerDown, resizing, width };
};

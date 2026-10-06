/**
 * Vertical placement of sidebar cards next to their highlights.
 *
 * Each card wants to sit level with its highlight (`anchorTop`). Cards may
 * not overlap, so they are pushed apart. When one card is active it stays
 * pinned to its anchor and the others move around it, which keeps the note
 * the writer is reading next to the prose it talks about.
 */

export interface LayoutItem<Id> {
  readonly anchorTop: number;
  readonly height: number;
  readonly id: Id;
}

export interface PlacedItem<Id> {
  readonly id: Id;
  readonly top: number;
}

const placeForward = <Id>(
  items: ReadonlyArray<LayoutItem<Id>>,
  startTop: number,
  gap: number,
): Array<PlacedItem<Id>> => {
  const placed: Array<PlacedItem<Id>> = [];
  let nextFree = startTop;

  for (const item of items) {
    const top = Math.max(item.anchorTop, nextFree);
    placed.push({ id: item.id, top });
    nextFree = top + item.height + gap;
  }

  return placed;
};

const placeBackward = <Id>(
  items: ReadonlyArray<LayoutItem<Id>>,
  limitTop: number,
  gap: number,
): Array<PlacedItem<Id>> => {
  const placed: Array<PlacedItem<Id>> = [];
  let ceiling = limitTop;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];

    if (item === undefined) {
      continue;
    }

    const top = Math.min(item.anchorTop, ceiling - gap - item.height);
    placed.push({ id: item.id, top });
    ceiling = top;
  }

  return placed.reverse();
};

export const layoutCommentary = <Id>(
  items: ReadonlyArray<LayoutItem<Id>>,
  activeId: Id | null,
  gap: number,
): ReadonlyArray<PlacedItem<Id>> => {
  const sorted = [...items].sort((a, b) => a.anchorTop - b.anchorTop);
  const activeIndex = activeId === null ? -1 : sorted.findIndex((item) => item.id === activeId);
  const active = sorted[activeIndex];

  if (active === undefined) {
    return placeForward(sorted, 0, gap);
  }

  const before = placeBackward(sorted.slice(0, activeIndex), active.anchorTop, gap);

  const after = placeForward(
    sorted.slice(activeIndex + 1),
    active.anchorTop + active.height + gap,
    gap,
  );

  const pinned = [...before, { id: active.id, top: active.anchorTop }, ...after];

  // Cards above the active one may have been pushed past the top edge.
  // In that case give up the pin and lay everything out from the top.
  if (pinned.some((item) => item.top < 0)) {
    return placeForward(sorted, 0, gap);
  }

  return pinned;
};

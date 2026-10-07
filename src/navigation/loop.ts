// Kept free of `vscode` imports so it can be unit-tested in plain Node.

export type Direction = 1 | -1;

/**
 * Picks the index of the file to open next inside one group, looping at both
 * ends. Returns -1 for an empty group.
 *
 * When the current file is no longer in the list (it was staged or unstaged
 * meanwhile), navigation continues from its old position `lastIndex`: "next"
 * opens the file that moved into that position, "previous" the one before it.
 */
export function pickIndex(
  keys: readonly string[],
  currentKey: string | undefined,
  lastIndex: number,
  direction: Direction,
): number {
  const count = keys.length;
  if (count === 0) {
    return -1;
  }
  const current = currentKey === undefined ? -1 : keys.indexOf(currentKey);
  if (current !== -1) {
    return (current + direction + count) % count;
  }
  if (direction === 1) {
    return lastIndex < count ? lastIndex : 0;
  }
  return (Math.min(lastIndex, count) - 1 + count) % count;
}

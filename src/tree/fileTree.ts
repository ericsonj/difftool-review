// Kept free of `vscode` imports so it can be unit-tested in plain Node.

/** A folder of the tree view mode; `folders` and `files` are sorted by name. */
export interface FolderEntry<T> {
  /** Label; spans several folders when single-child folders are compacted ("src/tree"). */
  readonly name: string;
  /** Path relative to the repository root, '' for the root. */
  readonly path: string;
  readonly folders: readonly FolderEntry<T>[];
  readonly files: readonly T[];
}

interface Draft<T> {
  readonly name: string;
  readonly path: string;
  readonly folders: Map<string, Draft<T>>;
  readonly files: T[];
}

/**
 * Groups items by the folders of their `/`-separated relative path. With
 * `compact`, a folder that only contains one other folder is merged with it,
 * like the built-in SCM view (`scm.compactFolders`).
 */
export function buildFileTree<T>(
  items: readonly T[],
  pathOf: (item: T) => string,
  compact: boolean,
): FolderEntry<T> {
  const root = draft<T>('', '');
  for (const item of items) {
    const segments = pathOf(item).split('/').filter(segment => segment.length > 0);
    segments.pop();
    let folder = root;
    for (const segment of segments) {
      let child = folder.folders.get(segment);
      if (!child) {
        child = draft(segment, folder.path === '' ? segment : `${folder.path}/${segment}`);
        folder.folders.set(segment, child);
      }
      folder = child;
    }
    folder.files.push(item);
  }
  return finish(root, pathOf, compact, true);
}

/** Items in the order the tree shows them: depth-first, folders before files. */
export function flattenFileTree<T>(folder: FolderEntry<T>): T[] {
  return [...folder.folders.flatMap(child => flattenFileTree(child)), ...folder.files];
}

function draft<T>(name: string, path: string): Draft<T> {
  return { name, path, folders: new Map(), files: [] };
}

function finish<T>(
  folder: Draft<T>,
  pathOf: (item: T) => string,
  compact: boolean,
  isRoot: boolean,
): FolderEntry<T> {
  let current = folder;
  let name = folder.name;
  while (compact && !isRoot && current.files.length === 0 && current.folders.size === 1) {
    const [only] = current.folders.values();
    current = only;
    name = `${name}/${only.name}`;
  }
  return {
    name,
    path: current.path,
    folders: [...current.folders.values()]
      .sort((a, b) => compareNames(a.name, b.name))
      .map(child => finish(child, pathOf, compact, false)),
    files: [...current.files].sort((a, b) => compareNames(pathOf(a), pathOf(b))),
  };
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

import * as assert from 'assert';
import { buildFileTree, FolderEntry, flattenFileTree } from '../../tree/fileTree';

const identity = (item: string): string => item;

/** Renders a tree as indented lines: folders end with '/', files show their full path. */
function render(folder: FolderEntry<string>, depth = 0): string[] {
  const indent = '  '.repeat(depth);
  return [
    ...folder.folders.flatMap(child => [`${indent}${child.name}/`, ...render(child, depth + 1)]),
    ...folder.files.map(file => `${indent}${file}`),
  ];
}

describe('buildFileTree', () => {
  it('nests files in their folders, folders before files, sorted by name', () => {
    const root = buildFileTree(['b.ts', 'src/z.ts', 'a.ts', 'lib/x.ts', 'src/a.ts'], identity, false);
    assert.deepStrictEqual(render(root), [
      'lib/',
      '  lib/x.ts',
      'src/',
      '  src/a.ts',
      '  src/z.ts',
      'a.ts',
      'b.ts',
    ]);
  });

  it('compacts chains of single-child folders', () => {
    const root = buildFileTree(['a/b/c/file.ts', 'a/b/c/other.ts'], identity, true);
    assert.deepStrictEqual(render(root), ['a/b/c/', '  a/b/c/file.ts', '  a/b/c/other.ts']);
    assert.strictEqual(root.folders[0].path, 'a/b/c');
  });

  it('stops compacting at folders that contain files or several folders', () => {
    const root = buildFileTree(['a/b/one.ts', 'a/b/c/two.ts', 'a/b/d/three.ts'], identity, true);
    assert.deepStrictEqual(render(root), [
      'a/b/',
      '  c/',
      '    a/b/c/two.ts',
      '  d/',
      '    a/b/d/three.ts',
      '  a/b/one.ts',
    ]);
    assert.strictEqual(root.folders[0].folders[0].path, 'a/b/c');
  });

  it('keeps one node per folder without compacting', () => {
    const root = buildFileTree(['a/b/file.ts'], identity, false);
    assert.deepStrictEqual(render(root), ['a/', '  b/', '    a/b/file.ts']);
  });

  it('sorts numbers naturally', () => {
    const root = buildFileTree(['file10.ts', 'file2.ts'], identity, true);
    assert.deepStrictEqual(root.files, ['file2.ts', 'file10.ts']);
  });
});

describe('flattenFileTree', () => {
  it('lists files depth-first in the order the tree shows them', () => {
    const root = buildFileTree(['z.ts', 'src/b.ts', 'src/util/a.ts', 'docs/readme.md'], identity, true);
    assert.deepStrictEqual(flattenFileTree(root), ['docs/readme.md', 'src/util/a.ts', 'src/b.ts', 'z.ts']);
  });

  it('returns nothing for an empty group', () => {
    assert.deepStrictEqual(flattenFileTree(buildFileTree([], identity, true)), []);
  });
});

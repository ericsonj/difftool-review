import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { API, GitExtension, Repository } from '../../git/git';

// Runs against the repository created by scripts/make-test-repo.sh:
// staged:  modified.ts (M), deleted.py (D), new_name.txt (R), added.go (A), both.js (M),
//          src/index.ts (M), src/util/strings.ts (M), src/tree/view.ts (A), docs/guide/intro.md (A)
// changes: both.js (M), untracked.rs (U), lib/helpers/format.ts (M)
// Listed in tree view mode order: depth-first, folders before files.
const STAGED_TREE = [
  'docs/guide/intro.md',
  'src/tree/view.ts',
  'src/util/strings.ts',
  'src/index.ts',
  'added.go',
  'both.js',
  'deleted.py',
  'modified.ts',
  'new_name.txt',
];
const CHANGES_TREE = ['lib/helpers/format.ts', 'both.js', 'untracked.rs'];
const STAGED = STAGED_TREE.map(file => path.posix.basename(file)).sort();
const CHANGES = CHANGES_TREE.map(file => path.posix.basename(file)).sort();
const EMPTY_SCHEME = 'difftool-review-empty';

async function waitFor<T>(probe: () => T | undefined, description: string): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function activeDiff(): vscode.TabInputTextDiff {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  assert.ok(input instanceof vscode.TabInputTextDiff, 'the active tab is a diff');
  return input;
}

function diffTabCount(): number {
  return vscode.window.tabGroups.all
    .flatMap(group => group.tabs)
    .filter(tab => tab.input instanceof vscode.TabInputTextDiff).length;
}

function fileName(uri: vscode.Uri): string {
  return path.basename(uri.path);
}

function gitRef(uri: vscode.Uri): string | undefined {
  return uri.scheme === 'git' ? (JSON.parse(uri.query) as { ref: string }).ref : undefined;
}

async function visitAll(count: number): Promise<string[]> {
  const visited: string[] = [];
  for (let step = 0; step < count; step++) {
    await vscode.commands.executeCommand('difftoolReview.nextFile');
    visited.push(fileName(activeDiff().modified));
    assert.strictEqual(diffTabCount(), 1, 'only one review diff is open');
  }
  return visited;
}

describe('Difftool Review', () => {
  let repository: Repository;

  before(async () => {
    // Without preview tabs, keeping a single diff open relies on the extension.
    await vscode.workspace
      .getConfiguration('workbench.editor')
      .update('enablePreview', false, vscode.ConfigurationTarget.Global);
    await vscode.extensions.getExtension('local.difftool-review')?.activate();
    const git = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports.getAPI(1) as API;
    repository = await waitFor(
      () => git.repositories.find(repo => repo.state.indexChanges.length === STAGED.length),
      'the test repository',
    );
  });

  it('opens the staged diffs with the right sides for each status', async () => {
    await vscode.commands.executeCommand('difftoolReview.startStaged');
    const sides = new Map<string, vscode.TabInputTextDiff>();
    for (let step = 0; step < STAGED.length; step++) {
      const diff = activeDiff();
      sides.set(fileName(diff.modified), diff);
      await vscode.commands.executeCommand('difftoolReview.nextFile');
    }
    assert.deepStrictEqual([...sides.keys()].sort(), STAGED);

    assert.strictEqual(sides.get('added.go')?.original.scheme, EMPTY_SCHEME);
    assert.strictEqual(gitRef(sides.get('added.go')!.modified), '');
    assert.strictEqual(gitRef(sides.get('deleted.py')!.original), 'HEAD');
    assert.strictEqual(sides.get('deleted.py')?.modified.scheme, EMPTY_SCHEME);
    assert.strictEqual(fileName(sides.get('new_name.txt')!.original), 'old_name.txt');
    assert.strictEqual(gitRef(sides.get('modified.ts')!.original), 'HEAD');
    assert.strictEqual(gitRef(sides.get('modified.ts')!.modified), '');
  });

  it('loops inside the staged group and keeps a single diff open', async () => {
    await vscode.commands.executeCommand('difftoolReview.startStaged');
    const first = fileName(activeDiff().modified);
    const visited = await visitAll(STAGED.length);
    assert.strictEqual(visited[visited.length - 1], first, 'wraps around to the first file');

    await vscode.commands.executeCommand('difftoolReview.prevFile');
    await vscode.commands.executeCommand('difftoolReview.nextFile');
    assert.strictEqual(fileName(activeDiff().modified), first, 'previous then next returns');
  });

  it('switches to the Changes group and diffs the working files', async () => {
    await vscode.commands.executeCommand('difftoolReview.startStaged');
    await vscode.commands.executeCommand('difftoolReview.switchGroup');
    const visited = new Set<string>();
    for (let step = 0; step < CHANGES.length; step++) {
      const diff = activeDiff();
      visited.add(fileName(diff.modified));
      assert.strictEqual(diff.modified.scheme, 'file');
      await vscode.commands.executeCommand('difftoolReview.nextFile');
    }
    assert.deepStrictEqual([...visited].sort(), CHANGES);
    assert.strictEqual(diffTabCount(), 1);
  });

  it('follows the tree order in tree view mode', async () => {
    // The empty side of a deleted file keeps the file's path, so this works for every status.
    const relativePath = (uri: vscode.Uri): string => path.posix.relative(repository.rootUri.path, uri.path);
    const groups = [
      ['difftoolReview.startStaged', STAGED_TREE],
      ['difftoolReview.startChanges', CHANGES_TREE],
    ] as const;
    await vscode.commands.executeCommand('difftoolReview.viewAsTree');
    try {
      assert.strictEqual(vscode.workspace.getConfiguration('difftoolReview').get('viewMode'), 'tree');
      for (const [start, expected] of groups) {
        await vscode.commands.executeCommand(start);
        const visited = [relativePath(activeDiff().modified)];
        for (let step = 1; step < expected.length; step++) {
          await vscode.commands.executeCommand('difftoolReview.nextFile');
          visited.push(relativePath(activeDiff().modified));
        }
        assert.deepStrictEqual(visited, expected, start);
      }
    } finally {
      await vscode.commands.executeCommand('difftoolReview.viewAsList');
    }
  });

  it('stages the file under review and continues with the remaining one', async () => {
    await vscode.commands.executeCommand('difftoolReview.startChanges');
    const staged = fileName(activeDiff().modified);
    await vscode.commands.executeCommand('difftoolReview.stageFile');
    await waitFor(
      () => (repository.state.workingTreeChanges.length + repository.state.untrackedChanges.length
        === CHANGES.length - 1 ? true : undefined),
      'the file to leave the Changes group',
    );

    await vscode.commands.executeCommand('difftoolReview.nextFile');
    const next = fileName(activeDiff().modified);
    assert.notStrictEqual(next, staged);
    assert.ok(CHANGES.includes(next));
  });
});

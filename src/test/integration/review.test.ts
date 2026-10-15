import * as assert from 'assert';
import * as fs from 'fs';
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

/** Starts the Changes group and returns the file names it loops over. */
async function changesGroupFiles(): Promise<string[]> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await vscode.commands.executeCommand('difftoolReview.startChanges');
  if (!(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff)) {
    return []; // The group is empty.
  }
  const first = fileName(activeDiff().modified);
  const visited = [first];
  for (;;) {
    await vscode.commands.executeCommand('difftoolReview.nextFile');
    const name = fileName(activeDiff().modified);
    if (name === first) {
      return visited.sort();
    }
    visited.push(name);
  }
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

  it('filters the Changes group to the files changed during an AI session', async () => {
    const root = repository.rootUri.fsPath;
    const both = path.join(root, 'both.js');
    const created = path.join(root, 'ai_new.ts');
    const bothBefore = await fs.promises.readFile(both, 'utf8');
    await vscode.commands.executeCommand('difftoolReview.startAiSession');
    try {
      // both.js already had an unstaged user edit before the session.
      await fs.promises.appendFile(both, 'ai line\n');
      await fs.promises.writeFile(created, 'export const ai = true;\n');
      await repository.status();
      const deadline = Date.now() + 15_000;
      let files = await changesGroupFiles();
      while (files.join() !== 'ai_new.ts,both.js' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 200));
        files = await changesGroupFiles();
      }
      assert.deepStrictEqual(files, ['ai_new.ts', 'both.js']);

      await vscode.commands.executeCommand('difftoolReview.startChanges');
      const sides = new Map<string, vscode.TabInputTextDiff>();
      for (let step = 0; step < 2; step++) {
        sides.set(fileName(activeDiff().modified), activeDiff());
        await vscode.commands.executeCommand('difftoolReview.nextFile');
      }
      assert.strictEqual(sides.get('ai_new.ts')?.original.scheme, EMPTY_SCHEME);
      const bothDiff = sides.get('both.js')!;
      assert.match(gitRef(bothDiff.original) ?? '', /^[0-9a-f]{40,64}$/, 'the left side is the snapshot tree');
      const left = (await vscode.workspace.openTextDocument(bothDiff.original)).getText();
      assert.ok(left.includes('unstaged line'), 'the user edit is part of the snapshot');
      assert.ok(!left.includes('ai line'), 'the AI edit is not');

      await vscode.commands.executeCommand('difftoolReview.showAllChanges');
      assert.deepStrictEqual(await changesGroupFiles(), [...CHANGES, 'ai_new.ts'].sort());
    } finally {
      await vscode.commands.executeCommand('difftoolReview.stopAiSession');
      await fs.promises.writeFile(both, bothBefore);
      await fs.promises.rm(created, { force: true });
      await repository.status();
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

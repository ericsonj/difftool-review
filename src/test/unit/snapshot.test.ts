import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  changedSince,
  CurrentState,
  hashWorkingFiles,
  parseLsTree,
  readSnapshot,
  snapshotWorkingTree,
} from '../../git/snapshot';

describe('parseLsTree', () => {
  it('maps paths to object ids, including paths with spaces', () => {
    const output = '100644 blob aaa\tsrc/a.ts\x00120000 blob bbb\tmy link\x00160000 commit ccc\tsub\x00';
    assert.deepStrictEqual([...parseLsTree(output)], [['src/a.ts', 'aaa'], ['my link', 'bbb'], ['sub', 'ccc']]);
  });

  it('returns an empty map for an empty tree', () => {
    assert.strictEqual(parseLsTree('').size, 0);
  });
});

describe('changedSince', () => {
  const snapshot = new Map([['same.ts', 'h1'], ['edited.ts', 'h2'], ['removed.ts', 'h3'], ['sub', 'c1']]);

  it('keeps new, edited, deleted and unknown files; drops files equal to the snapshot', () => {
    const current = new Map<string, CurrentState>([
      ['same.ts', { kind: 'file', blob: 'h1' }],
      ['edited.ts', { kind: 'file', blob: 'h2-new' }],
      ['removed.ts', { kind: 'deleted' }],
      ['new.ts', { kind: 'file', blob: 'h4' }],
      ['sub', { kind: 'unknown' }],
    ]);
    assert.deepStrictEqual([...changedSince(snapshot, current)].sort(), ['edited.ts', 'new.ts', 'removed.ts', 'sub']);
  });

  it('ignores a file that was already deleted when the session started', () => {
    const current = new Map<string, CurrentState>([['gone-before.ts', { kind: 'deleted' }]]);
    assert.strictEqual(changedSince(snapshot, current).size, 0);
  });
});

describe('snapshot of a real repository', function () {
  this.timeout(20_000);
  let root: string;
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const write = (file: string, content: string): void => { fs.writeFileSync(path.join(root, file), content); };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'difftool-review-snapshot-'));
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    write('mine.ts', 'committed\n');
    write('ai.ts', 'committed\n');
    write('doomed.ts', 'committed\n');
    fs.symlinkSync('mine.ts', path.join(root, 'link'));
    git('add', '.');
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'initial');
    // The user's own unstaged work before the session.
    write('mine.ts', 'committed\nuser edit\n');
    write('notes.md', 'untracked user notes\n');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('finds only the files changed after the snapshot, leaving the real index alone', async () => {
    const indexBefore = git('ls-files', '-s');
    const tree = await snapshotWorkingTree('git', root);
    assert.strictEqual(git('ls-files', '-s'), indexBefore, 'the real index is untouched');
    assert.strictEqual(git('status', '--porcelain'), ' M mine.ts\n?? notes.md\n');

    // The AI session.
    write('ai.ts', 'committed\nai edit\n');
    write('created.ts', 'ai file\n');
    fs.rmSync(path.join(root, 'doomed.ts'));

    const candidates = ['mine.ts', 'notes.md', 'ai.ts', 'created.ts', 'doomed.ts', 'link'];
    const current = await hashWorkingFiles('git', root, candidates);
    const changed = changedSince(await readSnapshot('git', root, tree), current);
    assert.deepStrictEqual([...changed].sort(), ['ai.ts', 'created.ts', 'doomed.ts']);
  });

  it('hashes a symlink as its target path, like git stores it', async () => {
    const tree = await snapshotWorkingTree('git', root);
    const snapshot = await readSnapshot('git', root, tree);
    const current = await hashWorkingFiles('git', root, ['link']);
    assert.deepStrictEqual(current.get('link'), { kind: 'file', blob: snapshot.get('link') });
  });
});

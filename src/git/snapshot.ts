// Kept free of `vscode` imports so it can be unit-tested in plain Node.
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Blob id of every file in a snapshot, by `/`-separated path relative to the repository root. */
export type SnapshotFiles = ReadonlyMap<string, string>;

/**
 * Current state of a changed file. `unknown` when it cannot be hashed like a
 * file: a directory, i.e. a submodule or nested repository.
 */
export type CurrentState =
  | { readonly kind: 'file'; readonly blob: string }
  | { readonly kind: 'deleted' }
  | { readonly kind: 'unknown' };

/**
 * Records the working tree (tracked and untracked files, `.gitignore` respected)
 * as a git tree object and returns its id. A temporary copy of the index is
 * used, so the real index is never touched; starting from a copy means only
 * files that changed since the last `git status` are hashed again.
 */
export async function snapshotWorkingTree(gitPath: string, root: string): Promise<string> {
  const tmpIndex = path.join(os.tmpdir(), `difftool-review-${randomBytes(8).toString('hex')}.index`);
  try {
    const realIndex = path.resolve(root, (await git(gitPath, root, ['rev-parse', '--git-path', 'index'])).trim());
    await fs.copyFile(realIndex, tmpIndex).catch(() => undefined); // A fresh repository has no index yet.
    // The index extensions of the real index only make sense for the real one.
    const env = { GIT_INDEX_FILE: tmpIndex };
    const config = ['-c', 'core.fsmonitor=false', '-c', 'core.splitIndex=false'];
    await git(gitPath, root, [...config, 'add', '--all'], { env });
    return (await git(gitPath, root, [...config, 'write-tree'], { env })).trim();
  } finally {
    await fs.rm(tmpIndex, { force: true });
  }
}

/** Lists the files of a snapshot; fails when the tree no longer exists (e.g. after `git gc`). */
export async function readSnapshot(gitPath: string, root: string, tree: string): Promise<SnapshotFiles> {
  return parseLsTree(await git(gitPath, root, ['ls-tree', '-r', '-z', tree]));
}

/**
 * Hashes the given files as `git add` would, without writing any object, so
 * the Git extension's `.git` watcher is not triggered.
 */
export async function hashWorkingFiles(
  gitPath: string,
  root: string,
  relativePaths: readonly string[],
): Promise<Map<string, CurrentState>> {
  const states = new Map<string, CurrentState>();
  const regularFiles: string[] = [];
  await Promise.all(relativePaths.map(async relativePath => {
    const absolute = path.join(root, relativePath);
    const stat = await fs.lstat(absolute).catch(() => undefined);
    if (!stat) {
      states.set(relativePath, { kind: 'deleted' });
    } else if (stat.isSymbolicLink()) {
      // `--stdin-paths` follows links, while git stores the link target as the blob.
      const target = await fs.readlink(absolute);
      const blob = (await git(gitPath, root, ['hash-object', '--stdin'], { input: target })).trim();
      states.set(relativePath, { kind: 'file', blob });
    } else if (stat.isFile()) {
      regularFiles.push(relativePath);
    } else {
      // `hash-object` fails on directories, and would fail the whole batch.
      states.set(relativePath, { kind: 'unknown' });
    }
  }));
  if (regularFiles.length > 0) {
    const output = await git(gitPath, root, ['hash-object', '--stdin-paths'], { input: `${regularFiles.join('\n')}\n` });
    const hashes = output.split('\n').filter(line => line.length > 0);
    regularFiles.forEach((relativePath, index) => { states.set(relativePath, { kind: 'file', blob: hashes[index] }); });
  }
  return states;
}

/**
 * Paths that differ from the snapshot: new since, deleted since, or with other
 * content. Unknown states count as changed, so nothing that may be part of the
 * session is hidden.
 */
export function changedSince(snapshot: SnapshotFiles, current: ReadonlyMap<string, CurrentState>): Set<string> {
  const changed = new Set<string>();
  for (const [relativePath, state] of current) {
    const before = snapshot.get(relativePath);
    const isChanged = state.kind === 'deleted' ? before !== undefined : state.kind === 'unknown' || before !== state.blob;
    if (isChanged) {
      changed.add(relativePath);
    }
  }
  return changed;
}

/** Parses `git ls-tree -r -z`: `<mode> SP <type> SP <object> TAB <path>` entries separated by NUL. */
export function parseLsTree(output: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of output.split('\0')) {
    const tab = entry.indexOf('\t');
    if (tab === -1) {
      continue;
    }
    const [, , object] = entry.slice(0, tab).split(' ');
    files.set(entry.slice(tab + 1), object);
  }
  return files;
}

interface GitOptions {
  readonly env?: Record<string, string>;
  readonly input?: string;
}

function git(gitPath: string, cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      gitPath,
      args,
      { cwd, env: { ...process.env, ...options.env }, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`git ${args.join(' ')}: ${stderr.trim() || error.message}`));
        } else {
          resolve(stdout);
        }
      },
    );
    child.stdin?.end(options.input);
  });
}

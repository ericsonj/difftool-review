import * as path from 'path';
import * as vscode from 'vscode';
import { Change, Repository } from '../git/git';
import { changeKey, GitService } from '../git/gitService';
import { changedSince, hashWorkingFiles, readSnapshot, SnapshotFiles, snapshotWorkingTree } from '../git/snapshot';
import { setContext } from '../util/context';
import { Debouncer } from '../util/debouncer';
import { errorMessage } from '../util/errors';

/** Workspace state key: sessions by repository root URI. */
const STATE_KEY = 'difftoolReview.aiSessions';

interface StoredSession {
  /** Tree object recording the working tree when the session started. */
  readonly tree: string;
  /** The Changes group only shows files changed since the snapshot. */
  readonly filter: boolean;
}

export interface Baseline {
  readonly tree: string;
  /** The file existed when the session started. */
  readonly exists: boolean;
}

/**
 * Tells the changes made during an AI session apart from the unstaged changes
 * that were already there.
 *
 * Starting a session records the working tree as a git tree object. A file of
 * the Changes group (which differs from the index) belongs to the session when
 * it also differs from that snapshot: new since, deleted since, or with other
 * content. The comparison hashes files without writing objects, so it does not
 * trigger the Git extension's refresh again.
 */
export class AiSession implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  private aiKeys = new Set<string>();
  private snapshot: { readonly tree: string; readonly files: SnapshotFiles } | undefined;
  private generation = 0;
  private readonly recomputer = new Debouncer(() => void this.recompute(), 150);
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly git: GitService,
    private readonly state: vscode.Memento,
  ) {
    this.subscriptions = [git.onDidChange(() => this.recomputer.trigger())];
    this.recomputer.trigger();
  }

  /** A session was started in the repository under review. */
  get active(): boolean {
    return this.stored() !== undefined;
  }

  get filterActive(): boolean {
    return this.stored()?.filter === true;
  }

  isSessionChange(change: Change): boolean {
    return this.aiKeys.has(changeKey(change));
  }

  /** The snapshot to diff a changed file against, while the filter is on. */
  baseline(change: Change): Baseline | undefined {
    const repo = this.git.repo;
    const stored = this.stored();
    if (!repo || !stored?.filter || this.snapshot?.tree !== stored.tree) {
      return undefined;
    }
    return { tree: stored.tree, exists: this.snapshot.files.has(relativePath(repo, change)) };
  }

  /** Starts a session, or moves the start of the current one to now. */
  async start(): Promise<void> {
    const repo = this.git.repo;
    if (!repo) {
      throw new Error('no Git repository is open');
    }
    const root = repo.rootUri.fsPath;
    const tree = await vscode.window.withProgress(
      { location: { viewId: 'difftoolReview.files' }, title: 'Recording the working tree' },
      () => snapshotWorkingTree(this.git.api.git.path, root),
    );
    this.snapshot = { tree, files: await readSnapshot(this.git.api.git.path, root, tree) };
    await this.store(repo, { tree, filter: true });
    await this.recompute();
  }

  async stop(): Promise<void> {
    const repo = this.git.repo;
    if (repo) {
      await this.store(repo, undefined);
    }
    await this.recompute();
  }

  async setFilter(filter: boolean): Promise<void> {
    const repo = this.git.repo;
    const stored = this.stored();
    if (!repo || !stored) {
      throw new Error('no AI session is running');
    }
    await this.store(repo, { ...stored, filter });
    await this.recompute();
  }

  dispose(): void {
    this.subscriptions.forEach(subscription => { subscription.dispose(); });
    this.recomputer.dispose();
    this.emitter.dispose();
  }

  private async recompute(): Promise<void> {
    const generation = ++this.generation;
    const repo = this.git.repo;
    const stored = this.stored();
    let keys = new Set<string>();
    if (repo && stored) {
      try {
        keys = await this.sessionChanges(repo, stored.tree);
      } catch (error) {
        if (generation === this.generation) {
          await this.recover(repo, stored.tree, error);
        }
        return;
      }
    }
    if (generation !== this.generation) {
      return; // A newer run started meanwhile; its result wins.
    }
    this.aiKeys = keys;
    await setContext('difftoolReview.aiSession', stored !== undefined);
    await setContext('difftoolReview.aiFilter', stored?.filter === true);
    this.emitter.fire();
  }

  private async sessionChanges(repo: Repository, tree: string): Promise<Set<string>> {
    const root = repo.rootUri.fsPath;
    if (this.snapshot?.tree !== tree) {
      this.snapshot = { tree, files: await readSnapshot(this.git.api.git.path, root, tree) };
    }
    const keysByPath = new Map(this.git.list('changes').map(change => [relativePath(repo, change), changeKey(change)]));
    const current = await hashWorkingFiles(this.git.api.git.path, root, [...keysByPath.keys()]);
    const changed = changedSince(this.snapshot.files, current);
    return new Set([...changed].flatMap(file => keysByPath.get(file) ?? []));
  }

  /**
   * A missing snapshot (pruned by `git gc`) ends the session. Other failures,
   * such as a file deleted while it was hashed, keep the previous result until
   * the next change.
   */
  private async recover(repo: Repository, tree: string, error: unknown): Promise<void> {
    if (this.snapshot?.tree === tree) {
      return;
    }
    await this.store(repo, undefined);
    void vscode.window.showWarningMessage(
      `Difftool Review: the AI session snapshot can no longer be read, so the session was stopped (${errorMessage(error)}).`,
    );
    await this.recompute();
  }

  private stored(): StoredSession | undefined {
    const root = this.git.repo?.rootUri.toString();
    return root === undefined ? undefined : this.sessions()[root];
  }

  private async store(repo: Repository, session: StoredSession | undefined): Promise<void> {
    const sessions = { ...this.sessions() };
    if (session) {
      sessions[repo.rootUri.toString()] = session;
    } else {
      delete sessions[repo.rootUri.toString()];
    }
    await this.state.update(STATE_KEY, sessions);
  }

  private sessions(): Record<string, StoredSession> {
    return this.state.get<Record<string, StoredSession>>(STATE_KEY, {});
  }
}

function relativePath(repo: Repository, change: Change): string {
  return path.posix.relative(repo.rootUri.path, change.uri.path);
}

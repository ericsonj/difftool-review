import * as vscode from 'vscode';
import { API, Change, GitExtension, Repository, Status } from './git';

export type Group = 'staged' | 'changes';

export const GROUPS: readonly Group[] = ['changes', 'staged'];

/** Identity of a change inside a group; stable across git refreshes. */
export function changeKey(change: Change): string {
  return change.uri.toString();
}

/**
 * Wraps the built-in Git extension API.
 *
 * The API returns a new wrapper object for every `Repository` access, so
 * repositories are identified by their root URI, never by object identity.
 */
export class GitService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly repositoryWatchers = new Map<string, vscode.Disposable>();
  private currentRoot: string | undefined;
  private gitApi: API | undefined;

  get api(): API {
    if (!this.gitApi) {
      throw new Error('GitService used before init()');
    }
    return this.gitApi;
  }

  async init(): Promise<void> {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
      throw new Error('the built-in Git extension was not found');
    }
    const exports = extension.isActive ? extension.exports : await extension.activate();
    if (!exports.enabled) {
      throw new Error('the built-in Git extension is disabled (setting "git.enabled")');
    }
    const api = exports.getAPI(1);
    this.gitApi = api;
    this.disposables.push(
      api.onDidChangeState(() => this.emitter.fire()),
      api.onDidOpenRepository(repository => this.watch(repository)),
      api.onDidCloseRepository(repository => this.unwatch(repository)),
      vscode.window.onDidChangeActiveTextEditor(editor => this.followEditor(editor)),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('difftoolReview.includeUntracked')) {
          this.emitter.fire();
        }
      }),
    );
    api.repositories.forEach(repository => this.watch(repository));
    this.followEditor(vscode.window.activeTextEditor);
  }

  /**
   * The repository under review: the one containing the last active file,
   * falling back to the first open repository.
   */
  get repo(): Repository | undefined {
    const repositories = this.gitApi?.repositories ?? [];
    return repositories.find(repository => rootOf(repository) === this.currentRoot)
      ?? repositories[0];
  }

  list(group: Group): Change[] {
    const state = this.repo?.state;
    if (!state) {
      return [];
    }
    if (group === 'staged') {
      return state.indexChanges;
    }
    const includeUntracked = vscode.workspace
      .getConfiguration('difftoolReview')
      .get<boolean>('includeUntracked', true);
    if (!includeUntracked) {
      return state.workingTreeChanges.filter(change => change.status !== Status.UNTRACKED);
    }
    // Depending on `git.untrackedChanges`, untracked files are either part of
    // `workingTreeChanges` or reported separately.
    const seen = new Set(state.workingTreeChanges.map(changeKey));
    const untracked = state.untrackedChanges.filter(change => !seen.has(changeKey(change)));
    return [...state.workingTreeChanges, ...untracked];
  }

  async stage(change: Change): Promise<void> {
    await this.requireRepo().add([change.uri.fsPath]);
  }

  /** `revert` in the Git API runs `git reset HEAD -- <paths>`, i.e. unstages. */
  async unstage(change: Change): Promise<void> {
    const paths = new Set([change.uri.fsPath, change.originalUri.fsPath]);
    await this.requireRepo().revert([...paths]);
  }

  /** Asks git for a fresh status; the tree updates through `onDidChange`. */
  async refresh(): Promise<void> {
    await this.repo?.status();
  }

  dispose(): void {
    this.disposables.forEach(disposable => { disposable.dispose(); });
    this.repositoryWatchers.forEach(watcher => { watcher.dispose(); });
    this.repositoryWatchers.clear();
    this.emitter.dispose();
  }

  private requireRepo(): Repository {
    const repository = this.repo;
    if (!repository) {
      throw new Error('no Git repository is open');
    }
    return repository;
  }

  private watch(repository: Repository): void {
    const root = rootOf(repository);
    if (!this.repositoryWatchers.has(root)) {
      this.repositoryWatchers.set(root, repository.state.onDidChange(() => this.emitter.fire()));
    }
    this.emitter.fire();
  }

  private unwatch(repository: Repository): void {
    const root = rootOf(repository);
    this.repositoryWatchers.get(root)?.dispose();
    this.repositoryWatchers.delete(root);
    this.emitter.fire();
  }

  private followEditor(editor: vscode.TextEditor | undefined): void {
    const uri = editor?.document.uri;
    if (!uri || !this.gitApi || (uri.scheme !== 'file' && uri.scheme !== 'git')) {
      return;
    }
    const repository = this.gitApi.getRepository(uri);
    const root = repository ? rootOf(repository) : undefined;
    if (root && root !== this.currentRoot) {
      this.currentRoot = root;
      this.emitter.fire();
    }
  }
}

function rootOf(repository: Repository): string {
  return repository.rootUri.toString();
}

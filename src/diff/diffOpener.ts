import * as vscode from 'vscode';
import { API, Change } from '../git/git';
import { Group } from '../git/gitService';
import { isAddition, isDeletion } from '../git/status';
import { emptyUri } from './emptyProvider';

/** Where the left side of a Changes diff comes from while reviewing an AI session. */
export interface SessionBaselines {
  /** The snapshot taken when the session started, or `undefined` outside a session review. */
  baseline(change: Change): { readonly tree: string; readonly exists: boolean } | undefined;
}

export interface DiffSides {
  readonly left: vscode.Uri;
  readonly right: vscode.Uri;
}

/**
 * Opens review diffs in the built-in diff editor and closes the previous one.
 *
 * The refs mirror `getLeftResource` / `getRightResource` of the Git extension:
 * `HEAD` is the last commit, `''` the index and `~` the index (or HEAD when the
 * file is not staged). While reviewing an AI session, the left side of a
 * Changes diff is the file as it was when the session started.
 */
export class DiffOpener {
  private lastSides: DiffSides | undefined;

  constructor(
    private readonly git: API,
    private readonly session: SessionBaselines,
  ) {}

  uris(group: Group, change: Change): DiffSides {
    const added = isAddition(change.status);
    const deleted = isDeletion(change.status);
    if (group === 'staged') {
      return {
        left: added ? emptyUri(change.uri) : this.git.toGitUri(change.originalUri, 'HEAD'),
        right: deleted ? emptyUri(change.uri) : this.git.toGitUri(change.uri, ''),
      };
    }
    const baseline = this.session.baseline(change);
    if (baseline) {
      return {
        left: baseline.exists ? this.git.toGitUri(change.uri, baseline.tree) : emptyUri(change.uri),
        right: deleted ? emptyUri(change.uri) : change.uri,
      };
    }
    return {
      left: added ? emptyUri(change.uri) : this.git.toGitUri(change.originalUri, '~'),
      right: deleted ? emptyUri(change.uri) : change.uri,
    };
  }

  async open(group: Group, change: Change): Promise<void> {
    const sides = this.uris(group, change);
    const previous = this.lastSides;
    const name = vscode.workspace.asRelativePath(change.uri);
    const title = `${name} (${diffLabel(group, this.session.baseline(change) !== undefined)})`;

    await vscode.commands.executeCommand('vscode.diff', sides.left, sides.right, title, {
      preview: true,
    });
    this.lastSides = sides;

    if (previous && !sameSides(previous, sides) && closePreviousEnabled()) {
      await closeDiffTabs(previous);
    }
  }
}

function diffLabel(group: Group, sessionReview: boolean): string {
  if (group === 'staged') {
    return 'Staged';
  }
  return sessionReview ? 'AI Session' : 'Changes';
}

export function isDiffTab(tab: vscode.Tab, sides: DiffSides): boolean {
  return tab.input instanceof vscode.TabInputTextDiff
    && tab.input.original.toString() === sides.left.toString()
    && tab.input.modified.toString() === sides.right.toString();
}

function sameSides(first: DiffSides, second: DiffSides): boolean {
  return first.left.toString() === second.left.toString()
    && first.right.toString() === second.right.toString();
}

function closePreviousEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('difftoolReview')
    .get<boolean>('closePreviousDiff', true);
}

/**
 * Closes the previous review diff by its URIs rather than by `Tab` object:
 * a preview tab replaced by the new diff is already gone, and a tab that was
 * pinned by editing is still found. Unsaved edits trigger the usual prompt.
 */
async function closeDiffTabs(sides: DiffSides): Promise<void> {
  const tabs = vscode.window.tabGroups.all
    .flatMap(group => group.tabs)
    .filter(tab => isDiffTab(tab, sides));
  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs, true);
  }
}

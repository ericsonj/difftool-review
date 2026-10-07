import * as vscode from 'vscode';
import { DiffOpener, isDiffTab } from '../diff/diffOpener';
import { Change } from '../git/git';
import { changeKey, GitService, Group, GROUPS } from '../git/gitService';
import { ReviewTree } from '../tree/reviewTree';
import { setContext } from '../util/context';
import { Direction, pickIndex } from './loop';

interface ActiveReview {
  readonly group: Group;
  readonly change: Change;
  readonly index: number;
}

const GROUP_NAMES: Record<Group, string> = {
  changes: 'changed',
  staged: 'staged',
};

/**
 * Keeps track of the group and file under review and moves between files,
 * looping inside the current group only.
 *
 * The current file is tracked by URI rather than index because the lists
 * change while reviewing (staging moves files between groups).
 */
export class Navigator implements vscode.Disposable {
  private group: Group = 'staged';
  private currentKey: string | undefined;
  private lastIndex = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly disposables: vscode.Disposable[];

  constructor(
    private readonly git: GitService,
    private readonly opener: DiffOpener,
    private readonly tree: ReviewTree,
    private readonly treeView: vscode.TreeView<unknown>,
  ) {
    this.disposables = [
      vscode.window.tabGroups.onDidChangeTabs(() => this.syncFromActiveTab()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.syncFromActiveTab()),
      git.onDidChange(() => this.syncFromActiveTab()),
    ];
    this.syncFromActiveTab();
  }

  next(): Promise<void> {
    return this.enqueue(() => this.move(1));
  }

  previous(): Promise<void> {
    return this.enqueue(() => this.move(-1));
  }

  start(group: Group): Promise<void> {
    return this.enqueue(() => this.startGroup(group));
  }

  switchGroup(): Promise<void> {
    return this.enqueue(() => this.startGroup(this.group === 'staged' ? 'changes' : 'staged'));
  }

  open(group: Group, change: Change): Promise<void> {
    return this.enqueue(() => this.show(group, change));
  }

  /** The file under review, if it is still part of `group`. */
  currentChange(group: Group): Change | undefined {
    if (group !== this.group) {
      return undefined;
    }
    return this.git.list(group).find(change => changeKey(change) === this.currentKey);
  }

  dispose(): void {
    this.disposables.forEach(disposable => { disposable.dispose(); });
  }

  /** Runs navigation steps one after another so fast key repeats don't interleave. */
  private enqueue(step: () => Promise<void>): Promise<void> {
    const run = this.queue.then(step);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async startGroup(group: Group): Promise<void> {
    if (this.git.list(group).length === 0) {
      showEmptyGroup(group);
      return;
    }
    this.group = group;
    this.currentKey = undefined;
    this.lastIndex = 0;
    await this.move(1);
  }

  private async move(direction: Direction): Promise<void> {
    const items = this.git.list(this.group);
    const index = pickIndex(items.map(changeKey), this.currentKey, this.lastIndex, direction);
    if (index === -1) {
      showEmptyGroup(this.group);
      return;
    }
    await this.show(this.group, items[index]);
  }

  private async show(group: Group, change: Change): Promise<void> {
    const key = changeKey(change);
    const index = this.git.list(group).findIndex(item => changeKey(item) === key);
    this.group = group;
    this.currentKey = key;
    this.lastIndex = Math.max(index, 0);
    await this.opener.open(group, change);
    await this.updateContext(true);
    await this.reveal(group, change);
  }

  private syncFromActiveTab(): void {
    const review = this.findActiveReview();
    if (review) {
      this.group = review.group;
      this.currentKey = changeKey(review.change);
      this.lastIndex = review.index;
    }
    void this.updateContext(review !== undefined);
  }

  /** Matches the active diff tab against the review diffs of both groups. */
  private findActiveReview(): ActiveReview | undefined {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!tab || !(tab.input instanceof vscode.TabInputTextDiff)) {
      return undefined;
    }
    for (const group of GROUPS) {
      const items = this.git.list(group);
      const index = items.findIndex(change => isDiffTab(tab, this.opener.uris(group, change)));
      if (index !== -1) {
        return { group, change: items[index], index };
      }
    }
    return undefined;
  }

  private async updateContext(reviewing: boolean): Promise<void> {
    await setContext('difftoolReview.reviewing', reviewing);
    await setContext('difftoolReview.group', this.group);
  }

  private async reveal(group: Group, change: Change): Promise<void> {
    // Revealing would also open a hidden view; only follow along when visible.
    if (!this.treeView.visible) {
      return;
    }
    try {
      await this.treeView.reveal(this.tree.fileNode(group, change), { select: true, focus: false });
    } catch {
      // The tree refreshes with a delay, so a just-moved file may not be known
      // to it yet. Highlighting is cosmetic; the diff is already open.
    }
  }
}

function showEmptyGroup(group: Group): void {
  vscode.window.setStatusBarMessage(
    `Difftool Review: no ${GROUP_NAMES[group]} files (Alt+G switches group)`,
    2500,
  );
}

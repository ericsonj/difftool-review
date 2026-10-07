import * as path from 'path';
import * as vscode from 'vscode';
import { Change } from '../git/git';
import { changeKey, GitService, Group, GROUPS } from '../git/gitService';
import { describeStatus } from '../git/status';
import { Debouncer } from '../util/debouncer';

/**
 * Scheme of the tree items' `resourceUri`. A custom scheme keeps the file icon
 * from the icon theme, while the status letter comes from our own decoration
 * provider (per group) instead of the Git extension's combined file status.
 */
export const ITEM_SCHEME = 'difftool-review-item';

export interface GroupNode {
  readonly kind: 'group';
  readonly group: Group;
}

export interface FileNode {
  readonly kind: 'file';
  readonly group: Group;
  readonly change: Change;
}

export type Node = GroupNode | FileNode;

const GROUP_LABELS: Record<Group, string> = {
  changes: 'Changes',
  staged: 'Staged Changes',
};

export function isFileNode(value: unknown): value is FileNode {
  return typeof value === 'object' && value !== null && (value as Node).kind === 'file';
}

export class ReviewTree implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private readonly groupNodes: Record<Group, GroupNode> = {
    changes: { kind: 'group', group: 'changes' },
    staged: { kind: 'group', group: 'staged' },
  };
  private readonly refresher = new Debouncer(() => this.emitter.fire(undefined), 100);
  private readonly subscription: vscode.Disposable;

  constructor(private readonly git: GitService) {
    this.subscription = git.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.refresher.trigger();
  }

  fileNode(group: Group, change: Change): FileNode {
    return { kind: 'file', group, change };
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      return this.git.repo ? GROUPS.map(group => this.groupNodes[group]) : [];
    }
    if (node.kind === 'file') {
      return [];
    }
    return this.git.list(node.group).map(change => this.fileNode(node.group, change));
  }

  /** Required by `TreeView.reveal`, used to highlight the file under review. */
  getParent(node: Node): Node | undefined {
    return node.kind === 'file' ? this.groupNodes[node.group] : undefined;
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return node.kind === 'group' ? this.groupItem(node) : this.fileItem(node);
  }

  dispose(): void {
    this.subscription.dispose();
    this.refresher.dispose();
    this.emitter.dispose();
  }

  private groupItem(node: GroupNode): vscode.TreeItem {
    const count = this.git.list(node.group).length;
    const item = new vscode.TreeItem(
      `${GROUP_LABELS[node.group]} (${count})`,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    item.id = `group:${node.group}`;
    item.contextValue = `group-${node.group}`;
    return item;
  }

  private fileItem(node: FileNode): vscode.TreeItem {
    const { group, change } = node;
    const relativePath = vscode.workspace.asRelativePath(change.uri, false);
    const folder = path.posix.dirname(relativePath);
    const item = new vscode.TreeItem(itemUri(group, change), vscode.TreeItemCollapsibleState.None);
    item.id = `${group}:${changeKey(change)}`;
    item.description = folder === '.' ? '' : folder;
    item.tooltip = fileTooltip(change, relativePath);
    item.contextValue = group === 'staged' ? 'staged' : 'change';
    item.command = {
      command: 'difftoolReview.openFile',
      title: 'Open Diff',
      arguments: [group, change],
    };
    return item;
  }
}

function itemUri(group: Group, change: Change): vscode.Uri {
  return change.uri.with({
    scheme: ITEM_SCHEME,
    query: new URLSearchParams({ group, status: String(change.status) }).toString(),
  });
}

function fileTooltip(change: Change, relativePath: string): string {
  const status = describeStatus(change.status).label;
  if (change.originalUri.toString() === change.uri.toString()) {
    return `${relativePath} • ${status}`;
  }
  const from = vscode.workspace.asRelativePath(change.originalUri, false);
  return `${from} → ${relativePath} • ${status}`;
}

/** Status letter and color for tree items, like the built-in SCM view. */
export class StatusDecorationProvider implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== ITEM_SCHEME) {
      return undefined;
    }
    const status = Number(new URLSearchParams(uri.query).get('status'));
    const description = describeStatus(status);
    return new vscode.FileDecoration(
      description.letter,
      description.label,
      new vscode.ThemeColor(description.colorId),
    );
  }
}

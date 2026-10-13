import * as path from 'path';
import * as vscode from 'vscode';
import { Change } from '../git/git';
import { changeKey, GitService, Group, GROUPS } from '../git/gitService';
import { describeStatus } from '../git/status';
import { Debouncer } from '../util/debouncer';
import { buildFileTree, FolderEntry, flattenFileTree } from './fileTree';

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

export interface FolderNode {
  readonly kind: 'folder';
  readonly group: Group;
  readonly entry: FolderEntry<Change>;
}

export interface FileNode {
  readonly kind: 'file';
  readonly group: Group;
  readonly change: Change;
}

export type Node = GroupNode | FolderNode | FileNode;

export type ViewMode = 'list' | 'tree';

/** One group laid out as folders, cached until git or the view mode changes. */
interface GroupTree {
  readonly root: FolderEntry<Change>;
  readonly files: Change[];
  /** Containing folder of each file (`file:<key>`) and folder (`folder:<path>`). */
  readonly parents: Map<string, FolderEntry<Change>>;
}

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
  private readonly groupTrees = new Map<Group, GroupTree>();
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly git: GitService) {
    // The cache is cleared right away, not debounced: the navigator reads the
    // file order while handling the same events.
    this.subscriptions = [
      git.onDidChange(() => this.invalidate()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('difftoolReview.viewMode')) {
          this.invalidate();
        }
      }),
    ];
  }

  get viewMode(): ViewMode {
    return vscode.workspace.getConfiguration('difftoolReview').get<ViewMode>('viewMode', 'list');
  }

  refresh(): void {
    this.refresher.trigger();
  }

  fileNode(group: Group, change: Change): FileNode {
    return { kind: 'file', group, change };
  }

  /** The files of a group in the order the panel shows them. */
  files(group: Group): Change[] {
    return this.viewMode === 'tree' ? this.groupTree(group).files : this.git.list(group);
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      return this.git.repo ? GROUPS.map(group => this.groupNodes[group]) : [];
    }
    if (node.kind === 'file') {
      return [];
    }
    if (this.viewMode === 'list') {
      return this.git.list(node.group).map(change => this.fileNode(node.group, change));
    }
    const folder = node.kind === 'folder' ? node.entry : this.groupTree(node.group).root;
    return [
      ...folder.folders.map(entry => this.folderNode(node.group, entry)),
      ...folder.files.map(change => this.fileNode(node.group, change)),
    ];
  }

  /** Required by `TreeView.reveal`, used to highlight the file under review. */
  getParent(node: Node): Node | undefined {
    if (node.kind === 'group') {
      return undefined;
    }
    if (this.viewMode === 'list') {
      return this.groupNodes[node.group];
    }
    const { root, parents } = this.groupTree(node.group);
    const key = node.kind === 'file' ? `file:${changeKey(node.change)}` : `folder:${node.entry.path}`;
    const parent = parents.get(key);
    return !parent || parent === root ? this.groupNodes[node.group] : this.folderNode(node.group, parent);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'group':
        return this.groupItem(node);
      case 'folder':
        return this.folderItem(node);
      case 'file':
        return this.fileItem(node);
    }
  }

  dispose(): void {
    this.subscriptions.forEach(subscription => { subscription.dispose(); });
    this.refresher.dispose();
    this.emitter.dispose();
  }

  private invalidate(): void {
    this.groupTrees.clear();
    this.refresh();
  }

  private folderNode(group: Group, entry: FolderEntry<Change>): FolderNode {
    return { kind: 'folder', group, entry };
  }

  private groupTree(group: Group): GroupTree {
    let groupTree = this.groupTrees.get(group);
    if (!groupTree) {
      const rootPath = this.git.repo?.rootUri.path ?? '/';
      const relativePath = (change: Change): string => path.posix.relative(rootPath, change.uri.path);
      const root = buildFileTree(this.git.list(group), relativePath, true);
      groupTree = { root, files: flattenFileTree(root), parents: indexParents(root) };
      this.groupTrees.set(group, groupTree);
    }
    return groupTree;
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

  private folderItem(node: FolderNode): vscode.TreeItem {
    const { group, entry } = node;
    const item = new vscode.TreeItem(entry.name, vscode.TreeItemCollapsibleState.Expanded);
    item.id = `folder:${group}:${entry.path}`;
    item.iconPath = vscode.ThemeIcon.Folder;
    const root = this.git.repo?.rootUri;
    if (root) {
      // Lets the file icon theme pick the folder icon.
      item.resourceUri = vscode.Uri.joinPath(root, entry.path);
    }
    item.tooltip = entry.path;
    item.contextValue = 'folder';
    return item;
  }

  private fileItem(node: FileNode): vscode.TreeItem {
    const { group, change } = node;
    const relativePath = vscode.workspace.asRelativePath(change.uri, false);
    const folder = path.posix.dirname(relativePath);
    const item = new vscode.TreeItem(itemUri(group, change), vscode.TreeItemCollapsibleState.None);
    item.id = `${group}:${changeKey(change)}`;
    // In tree mode the folder is already shown by the parent node.
    item.description = folder === '.' || this.viewMode === 'tree' ? '' : folder;
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

function indexParents(root: FolderEntry<Change>): Map<string, FolderEntry<Change>> {
  const parents = new Map<string, FolderEntry<Change>>();
  const visit = (folder: FolderEntry<Change>): void => {
    folder.files.forEach(change => { parents.set(`file:${changeKey(change)}`, folder); });
    folder.folders.forEach(child => {
      parents.set(`folder:${child.path}`, folder);
      visit(child);
    });
  };
  visit(root);
  return parents;
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

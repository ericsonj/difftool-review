import * as vscode from 'vscode';
import { ReviewComment, ReviewComments } from './comments/reviewComments';
import { copyReview } from './comments/reviewExporter';
import { DiffOpener } from './diff/diffOpener';
import { EMPTY_SCHEME, EmptyContentProvider } from './diff/emptyProvider';
import { Change } from './git/git';
import { GitService, Group } from './git/gitService';
import { Navigator } from './navigation/navigator';
import { isFileNode, ReviewTree, StatusDecorationProvider, ViewMode } from './tree/reviewTree';
import { setContext } from './util/context';
import { errorMessage } from './util/errors';

interface Services {
  readonly git: GitService;
  readonly tree: ReviewTree;
  readonly navigator: Navigator;
  readonly comments: ReviewComments;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const git = new GitService();
  context.subscriptions.push(git);
  try {
    await git.init();
  } catch (error) {
    const message = `Difftool Review: ${errorMessage(error)}`;
    void vscode.window.showErrorMessage(message);
    registerUnavailableCommands(context, message);
    return;
  }

  const tree = new ReviewTree(git);
  const treeView = vscode.window.createTreeView('difftoolReview.files', {
    treeDataProvider: tree,
    showCollapseAll: false,
  });
  const navigator = new Navigator(git, new DiffOpener(git.api), tree, treeView);
  const comments = new ReviewComments(git);
  const updateHasRepo = (): Promise<void> => setContext('difftoolReview.hasRepo', git.repo !== undefined);

  context.subscriptions.push(
    tree,
    treeView,
    navigator,
    comments,
    vscode.workspace.registerTextDocumentContentProvider(EMPTY_SCHEME, new EmptyContentProvider()),
    vscode.window.registerFileDecorationProvider(new StatusDecorationProvider()),
    git.onDidChange(() => void updateHasRepo()),
  );
  await updateHasRepo();

  const services: Services = { git, tree, navigator, comments };
  registerNavigationCommands(context, services);
  registerStagingCommands(context, services);
  registerCommentCommands(context, services);
}

export function deactivate(): void {
  // Everything is disposed through `context.subscriptions`.
}

function registerNavigationCommands(context: vscode.ExtensionContext, { git, navigator }: Services): void {
  register(context, 'difftoolReview.focus', () => vscode.commands.executeCommand('difftoolReview.files.focus'));
  register(context, 'difftoolReview.nextFile', () => navigator.next());
  register(context, 'difftoolReview.prevFile', () => navigator.previous());
  register(context, 'difftoolReview.switchGroup', () => navigator.switchGroup());
  register(context, 'difftoolReview.startStaged', () => navigator.start('staged'));
  register(context, 'difftoolReview.startChanges', () => navigator.start('changes'));
  register(context, 'difftoolReview.openFile', (group: Group, change: Change) => navigator.open(group, change));
  register(context, 'difftoolReview.refresh', () => git.refresh());
  register(context, 'difftoolReview.viewAsTree', () => setViewMode('tree'));
  register(context, 'difftoolReview.viewAsList', () => setViewMode('list'));
  // The built-in "next/previous change" (Alt+F5) act on the active diff editor
  // even when focus is elsewhere.
  register(context, 'difftoolReview.nextChange', () =>
    vscode.commands.executeCommand('workbench.action.compareEditor.nextChange'));
  register(context, 'difftoolReview.prevChange', () =>
    vscode.commands.executeCommand('workbench.action.compareEditor.previousChange'));
}

function registerStagingCommands(context: vscode.ExtensionContext, { git, navigator }: Services): void {
  // Called with the tree node from the inline buttons, or without arguments
  // from the shortcuts, in which case the file under review is used.
  register(context, 'difftoolReview.stageFile', async (node?: unknown) => {
    const change = isFileNode(node) ? node.change : navigator.currentChange('changes');
    if (!change) {
      vscode.window.setStatusBarMessage('Difftool Review: no changed file to stage', 2500);
      return;
    }
    await git.stage(change);
  });
  register(context, 'difftoolReview.unstageFile', async (node?: unknown) => {
    const change = isFileNode(node) ? node.change : navigator.currentChange('staged');
    if (!change) {
      vscode.window.setStatusBarMessage('Difftool Review: no staged file to unstage', 2500);
      return;
    }
    await git.unstage(change);
  });
  register(context, 'difftoolReview.stageLines', () =>
    vscode.commands.executeCommand('git.stageSelectedRanges'));
  register(context, 'difftoolReview.unstageLines', () =>
    vscode.commands.executeCommand('git.unstageSelectedRanges'));
}

function registerCommentCommands(context: vscode.ExtensionContext, { comments }: Services): void {
  // Opens a new, empty thread on the selection of the active diff's right side.
  register(context, 'difftoolReview.addComment', () =>
    vscode.commands.executeCommand('workbench.action.addComment'));
  register(context, 'difftoolReview.createComment', (reply: vscode.CommentReply) => comments.createComment(reply));
  register(context, 'difftoolReview.deleteThread', (thread: vscode.CommentThread) => comments.deleteThread(thread));
  register(context, 'difftoolReview.editComment', (comment: ReviewComment) => comments.editComment(comment));
  register(context, 'difftoolReview.saveComment', (comment: ReviewComment) => comments.saveComment(comment));
  register(context, 'difftoolReview.cancelEditComment', (comment: ReviewComment) =>
    comments.cancelEditComment(comment));
  register(context, 'difftoolReview.copyReview', () => copyReview(comments));
  register(context, 'difftoolReview.clearComments', () => comments.confirmAndClearAll());
}

/**
 * Writes the view mode where it is currently set, so a workspace value does
 * not keep overriding the toggle. The tree follows the configuration change.
 */
async function setViewMode(mode: ViewMode): Promise<void> {
  const config = vscode.workspace.getConfiguration('difftoolReview');
  const target = config.inspect<ViewMode>('viewMode')?.workspaceValue !== undefined
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await config.update('viewMode', mode, target);
}

/**
 * Keeps every contributed command registered when setup failed, so buttons and
 * shortcuts explain the problem instead of failing with "command not found".
 */
function registerUnavailableCommands(context: vscode.ExtensionContext, message: string): void {
  const contributes = (context.extension.packageJSON as PackageJson).contributes;
  for (const { command } of contributes.commands) {
    register(context, command, () => vscode.window.showErrorMessage(message));
  }
}

interface PackageJson {
  readonly contributes: { readonly commands: readonly { readonly command: string }[] };
}

/** Registers a command and reports failures (e.g. git errors) to the user. */
function register<Args extends unknown[]>(
  context: vscode.ExtensionContext,
  command: string,
  handler: (...args: Args) => unknown,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(command, async (...args: Args) => {
      try {
        await handler(...args);
      } catch (error) {
        void vscode.window.showErrorMessage(`Difftool Review: ${errorMessage(error)}`);
      }
    }),
  );
}

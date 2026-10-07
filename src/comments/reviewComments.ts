import * as vscode from 'vscode';
import { changeKey, GitService } from '../git/gitService';
import { isIndexUri } from '../git/gitUri';
import { isDeletion } from '../git/status';
import { setContext } from '../util/context';
import { Debouncer } from '../util/debouncer';

export const COMMENT_CONTROLLER_ID = 'difftoolReview';

export class ReviewComment implements vscode.Comment {
  mode = vscode.CommentMode.Preview;
  readonly author = { name: 'Reviewer' };
  readonly contextValue = 'reviewComment';
  /** Body to restore when an edit is cancelled. */
  savedBody: string | vscode.MarkdownString;

  constructor(
    public body: string | vscode.MarkdownString,
    readonly parent: vscode.CommentThread,
  ) {
    this.savedBody = body;
  }
}

/**
 * Review comments on the modified (right) side of review diffs, kept in
 * memory. Each thread holds a single comment, which keeps the export simple.
 */
export class ReviewComments implements vscode.Disposable {
  private readonly controller: vscode.CommentController;
  private readonly threads = new Set<vscode.CommentThread>();
  private readonly rangeRefresher = new Debouncer(() => this.installRangeProvider(), 200);
  private readonly subscription: vscode.Disposable;

  constructor(private readonly git: GitService) {
    this.controller = vscode.comments.createCommentController(COMMENT_CONTROLLER_ID, 'Difftool Review');
    this.controller.options = {
      prompt: 'Feedback for the AI…',
      placeHolder: 'Describe what should change',
    };
    this.installRangeProvider();
    // Which files are commentable depends on the Changes list.
    this.subscription = git.onDidChange(() => this.rangeRefresher.trigger());
  }

  /** Threads that hold a comment, in no particular order. */
  get activeThreads(): vscode.CommentThread[] {
    return [...this.threads].filter(thread => thread.comments.length > 0);
  }

  createComment(reply: vscode.CommentReply): void {
    const thread = reply.thread;
    thread.comments = [...thread.comments, new ReviewComment(new vscode.MarkdownString(reply.text), thread)];
    thread.canReply = false;
    thread.label = 'Feedback for the AI';
    this.threads.add(thread);
    this.updateContext();
  }

  deleteThread(thread: vscode.CommentThread): void {
    thread.dispose();
    this.threads.delete(thread);
    this.updateContext();
  }

  editComment(comment: ReviewComment): void {
    comment.mode = vscode.CommentMode.Editing;
    refreshThread(comment.parent);
  }

  /** VS Code has already written the edited text into `comment.body`. */
  saveComment(comment: ReviewComment): void {
    comment.savedBody = comment.body;
    comment.mode = vscode.CommentMode.Preview;
    refreshThread(comment.parent);
  }

  cancelEditComment(comment: ReviewComment): void {
    comment.body = comment.savedBody;
    comment.mode = vscode.CommentMode.Preview;
    refreshThread(comment.parent);
  }

  clearAll(): void {
    this.threads.forEach(thread => thread.dispose());
    this.threads.clear();
    this.updateContext();
  }

  async confirmAndClearAll(): Promise<void> {
    const count = this.activeThreads.length;
    if (count === 0) {
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      `Delete all ${count} review comment(s)?`,
      { modal: true },
      'Delete',
    );
    if (answer === 'Delete') {
      this.clearAll();
    }
  }

  dispose(): void {
    this.subscription.dispose();
    this.rangeRefresher.dispose();
    this.controller.dispose();
  }

  /** Assigning the provider again makes VS Code re-query the commenting ranges. */
  private installRangeProvider(): void {
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: document =>
        this.isReviewRightSide(document.uri) ? [wholeDocument(document)] : [],
    };
  }

  /**
   * True for the modified side of a review diff: the index version in a staged
   * diff, or a working file that is in the Changes group.
   */
  private isReviewRightSide(uri: vscode.Uri): boolean {
    if (uri.scheme === 'git') {
      return isIndexUri(uri);
    }
    if (uri.scheme !== 'file') {
      return false;
    }
    const key = uri.toString();
    return this.git.list('changes')
      .some(change => changeKey(change) === key && !isDeletion(change.status));
  }

  private updateContext(): void {
    void setContext('difftoolReview.hasComments', this.activeThreads.length > 0);
  }
}

function wholeDocument(document: vscode.TextDocument): vscode.Range {
  return new vscode.Range(0, 0, Math.max(document.lineCount - 1, 0), 0);
}

/** Reassigning the comments makes VS Code re-render the thread. */
function refreshThread(thread: vscode.CommentThread): void {
  thread.comments = [...thread.comments];
}

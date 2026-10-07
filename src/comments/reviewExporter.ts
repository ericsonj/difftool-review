import * as vscode from 'vscode';
import { parseGitUri } from '../git/gitUri';
import { formatReview, ReviewEntry } from './formatReview';
import { ReviewComments } from './reviewComments';

/** Lines of context shown around a single-line comment. */
const CONTEXT_LINES = 2;

/** Copies all review comments to the clipboard as Markdown for an AI chat. */
export async function copyReview(comments: ReviewComments): Promise<void> {
  const threads = comments.activeThreads;
  if (threads.length === 0) {
    vscode.window.setStatusBarMessage('Difftool Review: there are no comments to copy', 2500);
    return;
  }
  const config = vscode.workspace.getConfiguration('difftoolReview');
  const entries = await Promise.all(threads.map(toEntry));
  const markdown = formatReview(config.get<string>('copyPreamble', ''), entries);

  await vscode.env.clipboard.writeText(markdown);
  void vscode.window.showInformationMessage(
    `Difftool Review: copied ${threads.length} comment(s) to the clipboard`,
  );
  if (config.get<boolean>('clearCommentsAfterCopy', false)) {
    comments.clearAll();
  }
}

async function toEntry(thread: vscode.CommentThread): Promise<ReviewEntry> {
  const gitParams = parseGitUri(thread.uri);
  const fileUri = gitParams ? vscode.Uri.file(gitParams.path) : thread.uri;
  const { start, end } = lineSpan(thread.range);
  const document = await openDocument(thread.uri);
  return {
    path: vscode.workspace.asRelativePath(fileUri),
    startLine: start + 1,
    endLine: end + 1,
    staged: gitParams !== undefined,
    languageId: document?.languageId ?? '',
    code: document ? snippet(document, start, end) : '',
    body: thread.comments.map(commentText).join('\n\n'),
  };
}

/** 0-based inclusive lines; a selection ending at column 0 excludes that line. */
function lineSpan(range: vscode.Range | undefined): { start: number; end: number } {
  if (!range) {
    return { start: 0, end: 0 };
  }
  const endsAtLineStart = range.end.character === 0 && range.end.line > range.start.line;
  return {
    start: range.start.line,
    end: endsAtLineStart ? range.end.line - 1 : range.end.line,
  };
}

/** Binary files and files deleted since commenting cannot be opened as text. */
async function openDocument(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  try {
    return await vscode.workspace.openTextDocument(uri);
  } catch {
    return undefined;
  }
}

function snippet(document: vscode.TextDocument, start: number, end: number): string {
  const lastLine = document.lineCount - 1;
  const singleLine = start === end;
  const from = Math.max(singleLine ? start - CONTEXT_LINES : start, 0);
  const to = Math.min(singleLine ? end + CONTEXT_LINES : end, lastLine);
  const lines: string[] = [];
  for (let line = from; line <= to; line++) {
    lines.push(document.lineAt(line).text);
  }
  return lines.join('\n');
}

function commentText(comment: vscode.Comment): string {
  return typeof comment.body === 'string' ? comment.body : comment.body.value;
}

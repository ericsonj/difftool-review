import * as vscode from 'vscode';

export const EMPTY_SCHEME = 'difftool-review-empty';

/** Empty side of a diff for added or deleted files. */
export class EmptyContentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(): string {
    return '';
  }
}

/** Keeps the file's path so the diff editor still picks the right language. */
export function emptyUri(uri: vscode.Uri): vscode.Uri {
  return vscode.Uri.from({ scheme: EMPTY_SCHEME, path: uri.path });
}

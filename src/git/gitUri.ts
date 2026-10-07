import * as vscode from 'vscode';

/** Query of a `git:` URI as built by the Git extension's `toGitUri`. */
export interface GitUriParams {
  readonly path: string;
  /** `''` is the index, `'~'` the index or HEAD, `'HEAD'` the last commit. */
  readonly ref: string;
}

export function parseGitUri(uri: vscode.Uri): GitUriParams | undefined {
  if (uri.scheme !== 'git') {
    return undefined;
  }
  try {
    return JSON.parse(uri.query) as GitUriParams;
  } catch {
    return undefined;
  }
}

/** True for the right side of a staged diff, i.e. the index version of a file. */
export function isIndexUri(uri: vscode.Uri): boolean {
  return parseGitUri(uri)?.ref === '';
}

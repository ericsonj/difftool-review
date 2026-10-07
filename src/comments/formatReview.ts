// Kept free of `vscode` imports so it can be unit-tested in plain Node.

export interface ReviewEntry {
  /** Path relative to the workspace. */
  readonly path: string;
  /** 1-based, inclusive. */
  readonly startLine: number;
  readonly endLine: number;
  /** The comment was made on the index version (right side of a staged diff). */
  readonly staged: boolean;
  readonly languageId: string;
  /** Code the comment refers to; empty when the file could not be read. */
  readonly code: string;
  readonly body: string;
}

/** Formats review comments as Markdown feedback for an AI assistant. */
export function formatReview(preamble: string, entries: readonly ReviewEntry[]): string {
  const sections = sortEntries(entries).map(formatEntry);
  return `${[preamble.trim(), ...sections].filter(Boolean).join('\n\n')}\n`;
}

export function sortEntries(entries: readonly ReviewEntry[]): ReviewEntry[] {
  return [...entries].sort((first, second) =>
    comparePaths(first.path, second.path) || first.startLine - second.startLine);
}

function comparePaths(first: string, second: string): number {
  if (first === second) {
    return 0;
  }
  return first < second ? -1 : 1;
}

function formatEntry(entry: ReviewEntry): string {
  const lines = entry.startLine === entry.endLine
    ? `line ${entry.startLine}`
    : `lines ${entry.startLine}–${entry.endLine}`;
  const label = entry.staged ? ' (staged version)' : '';
  const parts = [`### ${entry.path}, ${lines}${label}`];
  if (entry.code) {
    const fence = fenceFor(entry.code);
    parts.push(`${fence}${fenceLanguage(entry.languageId)}\n${entry.code}\n${fence}`);
  }
  parts.push(entry.body.trim());
  return parts.join('\n');
}

/** A fence longer than any backtick run in the code, so the block can't end early. */
function fenceFor(code: string): string {
  const longestRun = Math.max(0, ...(code.match(/`+/g) ?? []).map(run => run.length));
  return '`'.repeat(Math.max(3, longestRun + 1));
}

function fenceLanguage(languageId: string): string {
  return languageId === 'plaintext' ? '' : languageId;
}

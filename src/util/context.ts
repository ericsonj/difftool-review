import * as vscode from 'vscode';

export type ContextKey =
  | 'difftoolReview.hasRepo'
  | 'difftoolReview.reviewing'
  | 'difftoolReview.group'
  | 'difftoolReview.hasComments';

const currentValues = new Map<ContextKey, unknown>();

/**
 * Sets a `when` clause context key. Keybindings depend on these keys instead
 * of focus, which keeps the shortcuts working from the tree, editor or panel.
 */
export async function setContext(key: ContextKey, value: unknown): Promise<void> {
  if (currentValues.has(key) && currentValues.get(key) === value) {
    return;
  }
  currentValues.set(key, value);
  await vscode.commands.executeCommand('setContext', key, value);
}

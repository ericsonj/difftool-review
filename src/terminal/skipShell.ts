// Kept free of `vscode` imports so it can be unit-tested in plain Node.

/**
 * Commands whose shortcuts are useful while the integrated terminal has
 * focus. The terminal sends every other key to the shell, so these must be
 * listed in `terminal.integrated.commandsToSkipShell`.
 */
export const TERMINAL_COMMANDS: readonly string[] = [
  'difftoolReview.focus',
  'difftoolReview.nextFile',
  'difftoolReview.prevFile',
  'difftoolReview.switchGroup',
  'difftoolReview.nextChange',
  'difftoolReview.prevChange',
  'difftoolReview.stageFile',
  'difftoolReview.unstageFile',
  'difftoolReview.copyReview',
];

/**
 * Returns the terminal commands not yet in `commandsToSkipShell`. A command
 * the user excluded on purpose (`-command`) counts as present.
 */
export function missingSkipShellCommands(current: readonly string[]): string[] {
  const entries = new Set(current);
  return TERMINAL_COMMANDS.filter(command => !entries.has(command) && !entries.has(`-${command}`));
}

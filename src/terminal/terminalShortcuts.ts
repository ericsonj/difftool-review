import * as vscode from 'vscode';
import { missingSkipShellCommands } from './skipShell';

const SECTION = 'terminal.integrated';
const SKIP_SHELL = 'commandsToSkipShell';
const OFFERED_KEY = 'difftoolReview.terminalShortcutsOffered';

/** Adds the missing review commands to the user's `commandsToSkipShell`. */
export async function enableTerminalShortcuts(): Promise<void> {
  const config = vscode.workspace.getConfiguration(SECTION);
  const current = config.inspect<string[]>(SKIP_SHELL)?.globalValue ?? [];
  const missing = missingSkipShellCommands(current);
  if (missing.length === 0) {
    vscode.window.setStatusBarMessage('Difftool Review: shortcuts already enabled in the terminal', 2500);
    return;
  }
  await config.update(SKIP_SHELL, [...current, ...missing], vscode.ConfigurationTarget.Global);
  vscode.window.setStatusBarMessage('Difftool Review: shortcuts enabled in the terminal', 2500);
}

/**
 * Offers once, the first time a terminal is open, to enable the shortcuts in
 * the terminal. User settings are only changed when the user accepts; the
 * command stays available afterwards.
 */
export function offerTerminalShortcuts(state: vscode.Memento): vscode.Disposable {
  if (state.get<boolean>(OFFERED_KEY) === true) {
    return new vscode.Disposable(() => undefined);
  }
  if (vscode.window.terminals.length > 0) {
    void offer(state);
    return new vscode.Disposable(() => undefined);
  }
  const listener = vscode.window.onDidOpenTerminal(() => {
    listener.dispose();
    void offer(state);
  });
  return listener;
}

async function offer(state: vscode.Memento): Promise<void> {
  const current = vscode.workspace.getConfiguration(SECTION).get<string[]>(SKIP_SHELL) ?? [];
  if (missingSkipShellCommands(current).length === 0) {
    return;
  }
  // Recorded before asking, so a dismissed notification is not shown again.
  await state.update(OFFERED_KEY, true);
  const enable = 'Enable';
  const choice = await vscode.window.showInformationMessage(
    'Difftool Review shortcuts (e.g. Ctrl+Alt+R) do not work while the terminal has focus: '
      + 'VS Code sends those keys to the shell. Add the review commands to '
      + '"terminal.integrated.commandsToSkipShell" in your user settings?',
    enable,
    'Not Now',
  );
  if (choice === enable) {
    await enableTerminalShortcuts();
  }
}

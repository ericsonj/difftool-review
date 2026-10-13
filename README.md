# Difftool Review

Review changes made by an AI assistant in VS Code: a minimal panel with **Changes** and **Staged Changes**, the built-in diff editor, file navigation that loops within one group, and review comments you can copy as feedback for an AI chat.

See `difftool-review-plan.md` in the source repository for the design.

## Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+R` | Open/focus the Difftool Review panel |
| `Alt+N` / `Alt+P` | Next / previous file, looping inside the current group |
| `Alt+G` | Switch group (Staged ↔ Changes) and open its first file |
| `Alt+.` / `Alt+,` | Next / previous change inside the diff |
| `Alt+S` | Stage current file (when reviewing Changes) |
| `Alt+U` | Unstage current file (when reviewing Staged) |
| `Ctrl+Alt+S` / `Ctrl+Alt+U` | Stage / unstage selected lines |
| `Ctrl+Alt+C` | Add a comment on the current line/selection |
| `Ctrl+Alt+Shift+C` | Copy all comments as AI feedback |

Shortcuts depend on extension state (context keys), not on focus, so they work from the tree, the editor and webview panels.

**Integrated terminal:** VS Code sends most keys to the shell while a terminal has focus. To use the shortcuts there, add the commands to `terminal.integrated.commandsToSkipShell` in your user settings:

```jsonc
"terminal.integrated.commandsToSkipShell": [
  "difftoolReview.nextFile", "difftoolReview.prevFile", "difftoolReview.switchGroup",
  "difftoolReview.nextChange", "difftoolReview.prevChange", "difftoolReview.copyReview"
]
```

If a shortcut does not fire, run **Developer: Toggle Keyboard Shortcuts Troubleshooting**, press the key and check the Output panel for conflicts.

## Settings

| Setting | Default | |
|---|---|---|
| `difftoolReview.viewMode` | `list` | Show files as a flat `list` or nested in a `tree` of folders (single-child folders compacted); `Alt+N`/`Alt+P` follow the tree order. Toggle with the list/tree button in the panel title |
| `difftoolReview.includeUntracked` | `true` | Show untracked files in the Changes group |
| `difftoolReview.closePreviousDiff` | `true` | Close the previous review diff when opening another file |
| `difftoolReview.clearCommentsAfterCopy` | `false` | Remove all comments after copying the review |
| `difftoolReview.copyPreamble` | "Please address…" | Text placed at the top of the copied review |

## Development

```bash
npm install
./scripts/make-test-repo.sh   # creates /tmp/difftool-review-test
```

Press **F5** ("Run Extension"). It compiles in watch mode and opens the test repository in an Extension Development Host, with workspace trust disabled for that window.

Difftool Review needs a trusted workspace: in Restricted Mode VS Code does not load the built-in Git extension, so Difftool Review cannot activate and its panel asks you to trust the folder.

| Command | |
|---|---|
| `npm run compile` / `npm run watch` | Build with `tsc` into `out/` |
| `npm run lint` | ESLint (typescript-eslint, type-checked) |
| `npm test` | Unit tests (mocha, plain Node) |
| `npm run test:integration` | Integration tests inside VS Code; set `VSCODE_EXECUTABLE=/usr/share/code/code` to use the installed VS Code instead of downloading one |
| `npx @vscode/vsce package` | Build the `.vsix` |

The build uses plain `tsc` rather than a bundler: `Status` in `src/git/git.d.ts` is a `const enum` that only `tsc` can inline, and the extension has no runtime dependencies to bundle.

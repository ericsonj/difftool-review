# Difftool Review

Review changes made by an AI assistant in VS Code: a minimal panel with **Changes** and **Staged Changes**, the built-in diff editor, file navigation that loops within one group, and review comments you can copy as feedback for an AI chat.

Install it from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ericsonjoseph.difftool-review) or run `code --install-extension ericsonjoseph.difftool-review`.

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

**Integrated terminal:** VS Code sends most keys to the shell while a terminal has focus, so the shortcuts only work there when their commands are listed in `terminal.integrated.commandsToSkipShell`. The first time a terminal is open, Difftool Review offers to add them to your user settings; you can also run **Difftool Review: Enable Shortcuts in Terminal** at any time. It adds:

```jsonc
"terminal.integrated.commandsToSkipShell": [
  "difftoolReview.focus", "difftoolReview.nextFile", "difftoolReview.prevFile",
  "difftoolReview.switchGroup", "difftoolReview.nextChange", "difftoolReview.prevChange",
  "difftoolReview.stageFile", "difftoolReview.unstageFile", "difftoolReview.copyReview"
]
```

Once added, the shell no longer receives these keys while their shortcut is active (e.g. `Alt+.` "insert last argument" during a review). To keep one for the shell, add it with a leading `-`, e.g. `"-difftoolReview.nextChange"`; the command leaves such entries alone.

If a shortcut does not fire, run **Developer: Toggle Keyboard Shortcuts Troubleshooting**, press the key and check the Output panel for conflicts.

## AI sessions

When you already have unstaged work of your own, the files an AI assistant edits get mixed into it in the Changes group. An AI session separates them:

1. Click **Start AI Session** (sparkle button in the panel title) before asking the assistant for changes. It records the working tree as it is now (a git tree object; the index is not touched).
2. Let the assistant work. The Changes group shows only the files that differ from that recording: edited, created or deleted since the start. The diff of each file compares with the recording, so your earlier edits to the same file are not shown.
3. Toggle with the filter button (or the one on the Changes row) to see all changes again.
4. **Restart AI Session** (panel `...` menu) moves the start to now, e.g. before the assistant's next turn. **Stop AI Session** ends it.

Files you edit yourself during a session count as session changes too. New files only show while `difftoolReview.includeUntracked` is on. The session survives a window reload.

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
pnpm install
./scripts/make-test-repo.sh   # creates /tmp/difftool-review-test
```

Press **F5** ("Run Extension"). It compiles in watch mode and opens the test repository in an Extension Development Host, with workspace trust disabled for that window.

Difftool Review needs a trusted workspace: in Restricted Mode VS Code does not load the built-in Git extension, so Difftool Review cannot activate and its panel asks you to trust the folder.

| Command | |
|---|---|
| `pnpm compile` / `pnpm watch` | Build with `tsc` into `out/` |
| `pnpm lint` | ESLint (typescript-eslint, type-checked) |
| `pnpm test` | Unit tests (mocha, plain Node) |
| `pnpm test:integration` | Integration tests inside VS Code; set `VSCODE_EXECUTABLE=/usr/share/code/code` to use the installed VS Code instead of downloading one |
| `pnpm package` | Build the `.vsix` (`vsce package --no-dependencies`: the extension has no runtime dependencies, and vsce's dependency scan does not support pnpm's `node_modules` layout) |

The build uses plain `tsc` rather than a bundler: `Status` in `src/git/git.d.ts` is a `const enum` that only `tsc` can inline, and the extension has no runtime dependencies to bundle.

## Releasing

Publishing a GitHub Release runs `.github/workflows/release.yml`: it runs the tests, packages one `.vsix`, publishes it to the Visual Studio Marketplace and attaches it to the release.

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry, commit (`chore(release): v0.2.0`) and push.
2. `gh release create v0.2.0 --generate-notes`

The tag must be `v` + the `package.json` version. The Marketplace has no semver pre-release versions, so channels use the minor number: **even** minor (`0.2.x`) for releases, **odd** minor (`0.3.x`) for GitHub pre-releases (`gh release create v0.3.0 --prerelease`), which are published with `--pre-release`. The workflow fails if tag, version or channel do not match.

The workflow needs the secret `VSCE_PAT` (Azure DevOps token, scope *Marketplace → Manage*) in the `marketplace` environment.

# Difftool Review — VS Code Extension Plan

A focused VS Code extension for reviewing changes made by an AI assistant: a minimal file panel (Changes / Staged Changes), the built-in diff editor, stable focus-independent shortcuts, looping file navigation within one group, and inline comments that can be copied as structured feedback for an AI chat.

---

## 1. Goals and non-goals

### Goals

1. **Strong language support** by reusing VS Code's built-in diff editor (syntax highlighting and language extensions work automatically).
2. **Minimal left panel** with exactly two groups: **Changes** and **Staged Changes**. Nothing else.
3. **Central diff view** using the built-in diff editor (no custom diff rendering).
4. **Looping file navigation**: next/previous file loops only within the current group (staged OR changes, never both).
5. **Stable shortcuts** that work regardless of which panel has focus.
6. **Only one review diff open at a time**: opening the next file closes the previous review diff.
7. **Review comments** on changed lines, copied to the clipboard in an AI-friendly Markdown format.

### Non-goals (for the MVP)

- Commit, push, pull, branches, history, stash, merge conflict resolution (use built-in Git for these).
- Persisting comments across VS Code restarts.
- Sending feedback directly to an AI API (clipboard only).
- Custom diff rendering or a webview UI.

---

## 2. Architecture overview

```
┌──────────────────────┐     ┌───────────────────────────────┐
│ Activity bar view    │     │ Built-in diff editor          │
│  "Difftool Review"   │     │  (vscode.diff command)        │
│  ├─ Changes (n)      │────▶│  left: HEAD / index           │
│  └─ Staged (n)       │     │  right: index / working file  │
└──────────┬───────────┘     │  + Comments API threads       │
           │                 └───────────────┬───────────────┘
           ▼                                 ▼
┌──────────────────────────────────────────────────────────────┐
│ Extension core                                               │
│  GitService      → wraps built-in Git extension API          │
│  ReviewTree      → TreeDataProvider (two groups)             │
│  DiffOpener      → builds URIs, opens diff, closes previous  │
│  Navigator       → current group + position, loop next/prev  │
│  ReviewComments  → CommentController, threads in memory      │
│  ReviewExporter  → formats comments + code → clipboard       │
└──────────────────────────────────────────────────────────────┘
```

### Existing work reused

| Need | Reused piece |
|---|---|
| Git state (staged/unstaged files, change events) | Built-in Git extension API (`vscode.git`, `getAPI(1)`) |
| File contents at HEAD / index | Git extension's `toGitUri(uri, ref)` and its `git:` file system provider |
| Diff view with language support | `vscode.diff` command (built-in diff editor) |
| Next/previous change inside a diff | `workbench.action.compareEditor.nextChange` / `previousChange` (the Alt+F5 commands) |
| Stage/unstage selected lines | `git.stageSelectedRanges` / `git.unstageSelectedRanges` |
| Comment UI (gutter "+", inline threads) | `vscode.comments.createCommentController` (Comments API) |
| File icons in the tree | `TreeItem.resourceUri` (uses the active file icon theme) |
| Tab management | `vscode.window.tabGroups` (stable API) |

---

## 3. Project setup

### 3.1 Scaffold

```bash
npx --package yo --package generator-code -- yo code
# Choose: New Extension (TypeScript), name: difftool-review, bundler: esbuild (recommended)
cd difftool-review
npm install
```

Run during development with **F5** (opens an Extension Development Host window). Open a test git repository in that window.

### 3.2 Git API types

Copy `git.d.ts` from the VS Code repository into `src/git/git.d.ts`:

- Source: `microsoft/vscode` → `extensions/git/src/api/git.d.ts`
- Use the version matching your VS Code release (check with `code --version`).

### 3.3 Folder structure

```
difftool-review/
├─ package.json
├─ tsconfig.json
├─ media/
│  └─ review.svg                 # activity bar icon (24x24, monochrome)
├─ src/
│  ├─ extension.ts               # activate(): wires everything together
│  ├─ git/
│  │  ├─ git.d.ts                # copied from VS Code repo
│  │  └─ gitService.ts           # repository access, lists, change events
│  ├─ tree/
│  │  └─ reviewTree.ts           # TreeDataProvider with two groups
│  ├─ diff/
│  │  ├─ diffOpener.ts           # URI building, open diff, close previous
│  │  └─ emptyProvider.ts        # empty document for added/deleted files
│  ├─ navigation/
│  │  └─ navigator.ts            # current group/position, loop next/prev
│  ├─ comments/
│  │  ├─ reviewComments.ts       # CommentController, create/edit/delete
│  │  └─ reviewExporter.ts       # Markdown export to clipboard
│  └─ util/
│     └─ context.ts              # setContext helpers
└─ src/test/                     # integration tests (@vscode/test-electron)
```

---

## 4. `package.json` contributions

```jsonc
{
  "name": "difftool-review",
  "displayName": "Difftool Review",
  "version": "0.0.1",
  "engines": { "vscode": "^1.90.0" },
  "extensionDependencies": ["vscode.git"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        { "id": "difftoolReview", "title": "Difftool Review", "icon": "media/review.svg" }
      ]
    },
    "views": {
      "difftoolReview": [
        { "id": "difftoolReview.files", "name": "Files" }
      ]
    },
    "commands": [
      { "command": "difftoolReview.focus",             "title": "Difftool Review: Open Review Panel" },
      { "command": "difftoolReview.nextFile",          "title": "Difftool Review: Next File in Group" },
      { "command": "difftoolReview.prevFile",          "title": "Difftool Review: Previous File in Group" },
      { "command": "difftoolReview.switchGroup",       "title": "Difftool Review: Switch Group (Staged/Changes)" },
      { "command": "difftoolReview.startStaged",       "title": "Difftool Review: Review Staged Changes" },
      { "command": "difftoolReview.startChanges",      "title": "Difftool Review: Review Changes" },
      { "command": "difftoolReview.nextChange",        "title": "Difftool Review: Next Change" },
      { "command": "difftoolReview.prevChange",        "title": "Difftool Review: Previous Change" },
      { "command": "difftoolReview.openFile",          "title": "Difftool Review: Open Diff" },
      { "command": "difftoolReview.stageFile",         "title": "Difftool Review: Stage File", "icon": "$(add)" },
      { "command": "difftoolReview.unstageFile",       "title": "Difftool Review: Unstage File", "icon": "$(remove)" },
      { "command": "difftoolReview.stageLines",        "title": "Difftool Review: Stage Selected Lines" },
      { "command": "difftoolReview.unstageLines",      "title": "Difftool Review: Unstage Selected Lines" },
      { "command": "difftoolReview.addComment",        "title": "Difftool Review: Add Comment" },
      { "command": "difftoolReview.createComment",     "title": "Add Comment" },
      { "command": "difftoolReview.deleteThread",      "title": "Delete Comment", "icon": "$(trash)" },
      { "command": "difftoolReview.copyReview",        "title": "Difftool Review: Copy Review for AI" },
      { "command": "difftoolReview.clearComments",     "title": "Difftool Review: Clear All Comments" },
      { "command": "difftoolReview.refresh",           "title": "Difftool Review: Refresh", "icon": "$(refresh)" }
    ],
    "keybindings": [
      { "key": "ctrl+alt+r",       "command": "difftoolReview.focus" },
      { "key": "alt+n",            "command": "difftoolReview.nextFile",    "when": "difftoolReview.hasRepo" },
      { "key": "alt+p",            "command": "difftoolReview.prevFile",    "when": "difftoolReview.hasRepo" },
      { "key": "alt+g",            "command": "difftoolReview.switchGroup", "when": "difftoolReview.hasRepo" },
      { "key": "alt+.",            "command": "difftoolReview.nextChange",  "when": "difftoolReview.reviewing" },
      { "key": "alt+,",            "command": "difftoolReview.prevChange",  "when": "difftoolReview.reviewing" },
      { "key": "alt+s",            "command": "difftoolReview.stageFile",   "when": "difftoolReview.reviewing && difftoolReview.group == 'changes'" },
      { "key": "alt+u",            "command": "difftoolReview.unstageFile", "when": "difftoolReview.reviewing && difftoolReview.group == 'staged'" },
      { "key": "ctrl+alt+s",       "command": "difftoolReview.stageLines",  "when": "difftoolReview.reviewing" },
      { "key": "ctrl+alt+u",       "command": "difftoolReview.unstageLines","when": "difftoolReview.reviewing" },
      { "key": "ctrl+alt+c",       "command": "difftoolReview.addComment",  "when": "difftoolReview.reviewing" },
      { "key": "ctrl+alt+shift+c", "command": "difftoolReview.copyReview",  "when": "difftoolReview.hasComments" }
    ],
    "menus": {
      "view/title": [
        { "command": "difftoolReview.refresh", "when": "view == difftoolReview.files", "group": "navigation" }
      ],
      "view/item/context": [
        { "command": "difftoolReview.stageFile",   "when": "view == difftoolReview.files && viewItem == change", "group": "inline" },
        { "command": "difftoolReview.unstageFile", "when": "view == difftoolReview.files && viewItem == staged", "group": "inline" }
      ],
      "comments/commentThread/context": [
        { "command": "difftoolReview.createComment", "group": "inline", "when": "commentController == difftoolReview && commentThreadIsEmpty" }
      ],
      "comments/commentThread/title": [
        { "command": "difftoolReview.deleteThread", "group": "navigation", "when": "commentController == difftoolReview && !commentThreadIsEmpty" }
      ],
      "commandPalette": [
        { "command": "difftoolReview.openFile", "when": "false" },
        { "command": "difftoolReview.createComment", "when": "false" },
        { "command": "difftoolReview.deleteThread", "when": "false" }
      ]
    },
    "configuration": {
      "title": "Difftool Review",
      "properties": {
        "difftoolReview.includeUntracked": {
          "type": "boolean", "default": true,
          "description": "Show untracked files in the Changes group."
        },
        "difftoolReview.closePreviousDiff": {
          "type": "boolean", "default": true,
          "description": "Close the previous review diff when opening another file."
        },
        "difftoolReview.clearCommentsAfterCopy": {
          "type": "boolean", "default": false,
          "description": "Remove all comments after copying the review."
        },
        "difftoolReview.copyPreamble": {
          "type": "string",
          "default": "Please address the following review comments on your changes:",
          "description": "Text placed at the top of the copied review."
        }
      }
    }
  }
}
```

### Default shortcuts summary

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

> If any shortcut does not fire, run **Developer: Toggle Keyboard Shortcuts Troubleshooting**, press the key, and check the Output panel for conflicts (other extensions or the desktop environment may capture it). Users can rebind everything in the Keyboard Shortcuts editor.

### Context keys set by the extension

| Key | Meaning |
|---|---|
| `difftoolReview.hasRepo` | A git repository is open |
| `difftoolReview.reviewing` | The active editor is a diff opened by Difftool Review |
| `difftoolReview.group` | `'staged'` or `'changes'`: group of the current file |
| `difftoolReview.hasComments` | At least one review comment exists |

These make shortcuts **focus-independent**: they depend on extension state, not on whether the tree or the editor has focus. This fixes the instability seen with plain custom keybindings.

---

## 5. Components in detail

### 5.1 GitService (`src/git/gitService.ts`)

Responsibilities:

- Get the Git API: `vscode.extensions.getExtension<GitExtension>('vscode.git')!.exports.getAPI(1)`.
- Wait for the API state to be `initialized` (`git.state`, `git.onDidChangeState`).
- Pick the repository:
  - MVP: the repository containing the active file, else the first one in `git.repositories`.
  - Later: quick pick when there are several.
- Expose lists:
  - `staged()` → `repo.state.indexChanges`
  - `changes()` → `repo.state.workingTreeChanges` plus `repo.state.untrackedChanges` when `difftoolReview.includeUntracked` is true (deduplicate by `uri.toString()`; depending on the `git.untrackedChanges` setting, untracked files may already be in `workingTreeChanges`).
- Ignore `mergeChanges` (out of scope: the panel shows only two groups).
- Fire an `onDidChange` event from `repo.state.onDidChange` and `git.onDidOpenRepository` / `onDidCloseRepository`.
- File-level staging:
  - Stage: `repo.add([uri.fsPath])`
  - Unstage: `repo.revert([uri.fsPath])` (in the Git API, `revert` resets the index for those paths, i.e. unstages; verify against your `git.d.ts`/Git extension version).

```ts
import * as vscode from 'vscode';
import { API, GitExtension, Repository, Change } from './git';

export type Group = 'staged' | 'changes';

export class GitService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private disposables: vscode.Disposable[] = [];
  api!: API;

  async init(): Promise<void> {
    const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!ext) { throw new Error('Built-in Git extension not found'); }
    const exports = ext.isActive ? ext.exports : await ext.activate();
    this.api = exports.getAPI(1);
    this.disposables.push(
      this.api.onDidOpenRepository(r => this.watch(r)),
      this.api.onDidCloseRepository(() => this.emitter.fire()),
    );
    this.api.repositories.forEach(r => this.watch(r));
  }

  private watch(repo: Repository) {
    this.disposables.push(repo.state.onDidChange(() => this.emitter.fire()));
    this.emitter.fire();
  }

  get repo(): Repository | undefined {
    const active = vscode.window.activeTextEditor?.document.uri;
    if (active) {
      const r = this.api.getRepository(active);
      if (r) { return r; }
    }
    return this.api.repositories[0];
  }

  list(group: Group): Change[] {
    const repo = this.repo;
    if (!repo) { return []; }
    if (group === 'staged') { return repo.state.indexChanges; }
    const includeUntracked = vscode.workspace
      .getConfiguration('difftoolReview').get<boolean>('includeUntracked', true);
    const all = [...repo.state.workingTreeChanges];
    if (includeUntracked) {
      const seen = new Set(all.map(c => c.uri.toString()));
      for (const c of repo.state.untrackedChanges ?? []) {
        if (!seen.has(c.uri.toString())) { all.push(c); }
      }
    }
    return all;
  }

  dispose() { this.disposables.forEach(d => d.dispose()); this.emitter.dispose(); }
}
```

> Note: `getRepository(uri)` may return the repo for the git URI side as well; when the active editor is a diff, prefer the URI stored by the Navigator.

### 5.2 ReviewTree (`src/tree/reviewTree.ts`)

- `TreeDataProvider<Node>` where `Node = GroupNode | FileNode`.
- Root returns exactly two `GroupNode`s: **Changes (n)** and **Staged Changes (n)**, both expanded by default.
- `FileNode`:
  - `label`: file name; `description`: relative folder path + status letter (M, A, D, R, U).
  - `resourceUri`: the file URI (gives file-type icons from the icon theme).
  - `contextValue`: `'change'` or `'staged'` (used by inline stage/unstage buttons).
  - `command`: `difftoolReview.openFile` with `(group, change)` arguments.
- Implement `getParent` so `treeView.reveal(node)` can highlight the current file during keyboard navigation.
- Refresh on `GitService.onDidChange` (debounce ~100 ms to avoid flicker).
- Create the view with `vscode.window.createTreeView('difftoolReview.files', { treeDataProvider, showCollapseAll: false })`.

Status letters (from the `Status` enum in `git.d.ts`):

| Status | Letter |
|---|---|
| `INDEX_MODIFIED`, `MODIFIED` | M |
| `INDEX_ADDED`, `INTENT_TO_ADD` | A |
| `INDEX_DELETED`, `DELETED` | D |
| `INDEX_RENAMED`, `INTENT_TO_RENAME` | R |
| `UNTRACKED` | U |
| `TYPE_CHANGED` | T |

### 5.3 DiffOpener (`src/diff/diffOpener.ts`)

Builds left/right URIs and opens the built-in diff editor.

| Group | Left side | Right side |
|---|---|---|
| Staged | `toGitUri(originalUri, 'HEAD')` | `toGitUri(uri, '')` (index) |
| Changes | `toGitUri(originalUri, '~')` (index, or HEAD if not staged) | `uri` (real working file) |

These refs mirror what the built-in Git extension does (see `getLeftResource` / `getRightResource` in `extensions/git/src/repository.ts`); verify them against your VS Code version during implementation.

Special cases:

| Case | Left | Right |
|---|---|---|
| Added (staged `INDEX_ADDED`) | empty document | index version |
| Untracked / intent-to-add | empty document | working file |
| Deleted (staged or unstaged) | HEAD or index version | empty document |
| Renamed | `originalUri` at the old path | `uri` at the new path |

Empty document: register a `TextDocumentContentProvider` for scheme `difftool-review-empty` that always returns `''`, and use `vscode.Uri.from({ scheme: 'difftool-review-empty', path: change.uri.path })` so the language mode still matches the file extension.

Opening and closing the previous diff:

```ts
import * as vscode from 'vscode';
import { API, Change, Status } from '../git/git';
import { Group } from '../git/gitService';

const EMPTY_SCHEME = 'difftool-review-empty';

export class DiffOpener {
  private lastTab: vscode.Tab | undefined;

  constructor(private readonly git: API) {}

  private empty(uri: vscode.Uri) {
    return vscode.Uri.from({ scheme: EMPTY_SCHEME, path: uri.path });
  }

  uris(group: Group, c: Change): { left: vscode.Uri; right: vscode.Uri } {
    const added = [Status.INDEX_ADDED, Status.UNTRACKED, Status.INTENT_TO_ADD].includes(c.status);
    const deleted = [Status.INDEX_DELETED, Status.DELETED].includes(c.status);
    if (group === 'staged') {
      return {
        left: added ? this.empty(c.uri) : this.git.toGitUri(c.originalUri, 'HEAD'),
        right: deleted ? this.empty(c.uri) : this.git.toGitUri(c.uri, ''),
      };
    }
    return {
      left: added ? this.empty(c.uri) : this.git.toGitUri(c.originalUri, '~'),
      right: deleted ? this.empty(c.uri) : c.uri,
    };
  }

  async open(group: Group, c: Change): Promise<void> {
    const { left, right } = this.uris(group, c);
    const name = vscode.workspace.asRelativePath(c.uri);
    const title = `${name} (${group === 'staged' ? 'Staged' : 'Changes'})`;

    const closePrevious = vscode.workspace
      .getConfiguration('difftoolReview').get<boolean>('closePreviousDiff', true);
    const previous = this.lastTab;

    await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
    this.lastTab = vscode.window.tabGroups.activeTabGroup.activeTab;

    if (closePrevious && previous && previous !== this.lastTab && this.isStillOpen(previous)) {
      await vscode.window.tabGroups.close(previous, true);
    }
  }

  private isStillOpen(tab: vscode.Tab): boolean {
    return vscode.window.tabGroups.all.some(g => g.tabs.includes(tab));
  }
}
```

Closing via `tabGroups.close` works even when the user's global preview setting is off or the previous tab was pinned by editing. If the previous file has unsaved edits, VS Code prompts as usual.

### 5.4 Navigator (`src/navigation/navigator.ts`)

State:

- `group: Group` — current group (default: `'staged'`, because the main workflow is reviewing what the AI staged).
- `currentKey: string | undefined` — `uri.toString()` of the current file (track by path, not by index, because lists change after staging/unstaging).

Behaviour:

- `next()` / `prev()`: find `currentKey` in the current group's list; move by ±1 with wrap-around (modulo). If not found (file just moved to the other group), open the item that now sits at the same position, or the first item.
- `switchGroup()`: toggle group and open the first file of the new group.
- `startStaged()` / `startChanges()`: set group explicitly and open the first file.
- Empty group: show `vscode.window.setStatusBarMessage('Difftool Review: no staged files', 2500)` and do nothing.
- After every open: update context keys (`difftoolReview.reviewing`, `difftoolReview.group`) and reveal the node in the tree (`treeView.reveal(node, { select: true, focus: false })`).
- Listen to `vscode.window.tabGroups.onDidChangeTabs` / `onDidChangeActiveTextEditor`: when the active tab is a `TabInputTextDiff` opened by Difftool Review, sync `group` and `currentKey`; otherwise set `difftoolReview.reviewing` to `false`.

```ts
async move(direction: 1 | -1): Promise<void> {
  const items = this.git.list(this.group);
  if (items.length === 0) {
    vscode.window.setStatusBarMessage(`Difftool Review: no ${this.group} files`, 2500);
    return;
  }
  let i = items.findIndex(c => c.uri.toString() === this.currentKey);
  if (i === -1) {
    i = direction === 1 ? Math.min(this.lastIndex, items.length - 1) : items.length - 1;
  } else {
    i = (i + direction + items.length) % items.length; // loop inside the group
  }
  this.lastIndex = i;
  this.currentKey = items[i].uri.toString();
  await this.opener.open(this.group, items[i]);
  await this.updateContext();
}
```

Change navigation inside a file (`difftoolReview.nextChange` / `prevChange`): delegate to the built-in commands that already work for Alt+F5:

```ts
vscode.commands.executeCommand('workbench.action.compareEditor.nextChange');
vscode.commands.executeCommand('workbench.action.compareEditor.previousChange');
```

### 5.5 Staging actions

- File level: `GitService` stage/unstage, then `Navigator` keeps position (the file leaves the current group, so "next" naturally lands on the following file).
- Line level: delegate to `git.stageSelectedRanges` / `git.unstageSelectedRanges` with the diff editor active. Test both in the staged and unstaged diffs; the built-in commands work on the modified side of a git diff.
- Optional setting later: auto-advance to the next file after unstaging a whole file.

### 5.6 Review comments (`src/comments/reviewComments.ts`)

Based on the official sample `microsoft/vscode-extension-samples` → `comment-sample`.

Controller:

```ts
const controller = vscode.comments.createCommentController('difftoolReview', 'Difftool Review');
controller.options = { prompt: 'Feedback for the AI…', placeHolder: 'Describe what should change' };
controller.commentingRangeProvider = {
  provideCommentingRanges(document) {
    if (!isReviewRightSide(document.uri)) { return []; }
    return [new vscode.Range(0, 0, Math.max(document.lineCount - 1, 0), 0)];
  },
};
```

`isReviewRightSide(uri)` returns `true` only for the modified side of a review diff:

- `file:` scheme files that are in the Changes list, or
- `git:` scheme URIs whose `ref` is `''` (index), i.e. the right side of a staged diff.

The `git:` URI query is JSON (`{ path, ref }`), so parse it with `JSON.parse(uri.query)`.

Restricting comments to the right side keeps feedback attached to the new code. MVP allows commenting on any line of that side; a later improvement can limit it to changed lines only (requires computing the diff, see section 9).

Comment model:

```ts
class ReviewComment implements vscode.Comment {
  mode = vscode.CommentMode.Preview;
  author = { name: 'Reviewer' };
  contextValue = 'reviewComment';
  constructor(public body: vscode.MarkdownString, public parent: vscode.CommentThread) {}
}
```

Commands:

| Command | Behaviour |
|---|---|
| `difftoolReview.addComment` | Executes the built-in "Add Comment on Current Selection" command (`workbench.action.addComment`; verify the id in the Keyboard Shortcuts editor), which opens a new empty thread on the selection |
| `difftoolReview.createComment` (`CommentReply`) | Adds a `ReviewComment` with `reply.text` to `reply.thread`; sets `thread.canReply = false` (one comment per thread keeps the export simple) and `thread.label` |
| `difftoolReview.deleteThread` (`CommentThread`) | `thread.dispose()` and remove from the store |
| `difftoolReview.clearComments` | Dispose all threads |

Keep all threads in a `Set<vscode.CommentThread>` and update `difftoolReview.hasComments` whenever it changes.

Optional (small): editing comments, using the sample's `comments/comment/title` edit button and `comments/comment/context` save/cancel commands.

### 5.7 ReviewExporter (`src/comments/reviewExporter.ts`)

For each thread (sorted by file path, then start line):

1. Resolve the real file path: for `file:` use `uri`; for `git:` parse `JSON.parse(uri.query).path`.
2. Relative path: `vscode.workspace.asRelativePath(path)`.
3. Line numbers: `thread.range.start.line + 1` to `thread.range.end.line + 1`.
4. Code snippet: open the document (`vscode.workspace.openTextDocument(thread.uri)`), take full lines of the range. If the range is a single line, also include up to 2 lines of context above and below (configurable later).
5. Language: `document.languageId` for the code fence.
6. Label: `(staged version)` when the URI is a `git:` index URI.

Output format:

````markdown
Please address the following review comments on your changes:

### src/api/users.ts, lines 42–45
```typescript
try {
  await db.save(user);
} catch (e) {}
```
Don't swallow this exception, log it and rethrow.

### src/utils/date.ts, line 12 (staged version)
```typescript
const d = new Date(input);
```
Use the existing parseDate() helper instead.
````

Then:

```ts
await vscode.env.clipboard.writeText(markdown);
vscode.window.showInformationMessage(`Difftool Review: copied ${count} comment(s) to the clipboard`);
if (config.get('clearCommentsAfterCopy')) { clearAll(); }
```

Snippets make the feedback robust even if line numbers shift after later edits.

---

## 6. Edge cases checklist

| Case | Handling |
|---|---|
| No git repository | Tree shows a welcome message (`viewsWelcome` contribution); shortcuts disabled via `difftoolReview.hasRepo` |
| Empty group | Group still shown with "(0)"; navigation shows a status bar message |
| File both staged and unstaged | Appears in both groups (correct: different diffs) |
| Added / untracked file | Left side empty document |
| Deleted file | Right side empty document; commenting disabled on empty side |
| Renamed file | Left uses `originalUri`, right uses `uri` |
| Binary files | Diff editor shows its own "binary" message; skip in exporter |
| Very large files | Rely on built-in diff editor limits |
| Multiple repositories | MVP: repo of active file or first repo; later: quick pick + per-repo state |
| Merge conflicts | Ignored (not part of the two groups) |
| List changes while reviewing | Track current file by URI, fall back to same index |
| Previous tab already closed by user | `isStillOpen` check before closing |
| Unsaved edits in previous diff | VS Code save prompt on close |
| Comments on a file that later changes | Threads stay at their range; exporter includes snippet text |
| Git extension disabled | Show error message on activation |

---

## 7. Milestones and tasks

### M0 — Setup (1–2 h)
- [x] Scaffold (TypeScript, built with plain `tsc`: esbuild cannot inline the `Status` const enum from `git.d.ts`)
- [x] Copy `git.d.ts`
- [x] Add activity bar container, view, icon
- [x] `extensionDependencies: ["vscode.git"]`
- [ ] Verify F5 launches and the panel appears

### M1 — Git service and tree (3–5 h)
- [x] `GitService.init()` with API state handling
- [x] `list('staged')` / `list('changes')` incl. untracked option
- [x] `ReviewTree` with two groups, counts, status letters, file icons
- [x] Refresh on repository change (debounced)
- [x] `viewsWelcome` for "no repository"

### M2 — Diff opening (2–3 h)
- [x] `emptyProvider` content provider
- [x] `DiffOpener.uris()` for all statuses
- [x] Open diff on tree click
- [x] Close previous review tab (setting `closePreviousDiff`)
- [ ] Manually verify: modified, added, deleted, renamed, untracked, staged + unstaged same file

### M3 — Navigation and shortcuts (2–3 h)
- [x] `Navigator` with group state and looping next/prev
- [x] `switchGroup`, `startStaged`, `startChanges`
- [x] Context keys `hasRepo`, `reviewing`, `group`
- [x] Sync state from active tab changes
- [x] Reveal current file in tree
- [x] Next/prev change delegation
- [ ] Keybindings in `package.json`; test with focus in tree, editor, terminal

### M4 — Staging actions (2–4 h)
- [x] Stage/unstage file (inline tree buttons + shortcuts)
- [x] Stage/unstage selected lines (delegate to built-in commands)
- [x] Keep navigation position after staging changes

### M5 — Comments (3–5 h)
- [x] Comment controller with right-side-only ranges
- [x] Create thread / delete thread / clear all
- [x] `difftoolReview.addComment` shortcut
- [x] `hasComments` context key

### M6 — Copy for AI (2–3 h)
- [x] Exporter with path, lines, language fence, snippet
- [x] Sorting, staged label, preamble setting
- [x] Clipboard + notification + optional clear

### M7 — Edge cases and polish (1–3 days)
- [ ] Work through section 6
- [ ] Multi-repo quick pick
- [ ] README with shortcuts and screenshots (README written; screenshots missing)

### M8 — Tests and packaging (0.5–1 day)
- [x] Integration tests (see section 8): `npm run test:integration`; comments/export not covered yet
- [ ] `npx @vscode/vsce package`
- [ ] `code --install-extension difftool-review-0.0.1.vsix`

**Estimate:** MVP (M0–M6) about 3–4 days by hand, less with AI assistance; robust version (M0–M8) about 1–2 weeks.

---

## 8. Testing

### Test repository script

```bash
#!/usr/bin/env bash
set -e
rm -rf /tmp/difftool-review-test && mkdir /tmp/difftool-review-test && cd /tmp/difftool-review-test
git init -q
printf 'export const a = 1;\nexport const b = 2;\n' > modified.ts
printf 'def hello():\n    return "hi"\n' > deleted.py
printf 'old name\n' > old_name.txt
printf 'staged and unstaged\n' > both.js
git add . && git commit -qm "initial"

printf 'export const a = 10;\nexport const b = 2;\nexport const c = 3;\n' > modified.ts
git rm -q deleted.py
git mv old_name.txt new_name.txt
printf 'brand new\n' > added.go && git add added.go
printf 'staged line\n' >> both.js && git add both.js
printf 'unstaged line\n' >> both.js
printf 'untracked\n' > untracked.rs
git add modified.ts
echo "Test repo ready at /tmp/difftool-review-test"
```

### Manual test checklist

- [ ] Both groups show correct files and counts
- [ ] Each status opens the correct diff (both sides)
- [ ] `Alt+N`/`Alt+P` loop only within the current group, with wrap-around
- [ ] `Alt+G` switches group
- [ ] Only one review diff tab open at a time
- [ ] Shortcuts work with focus in tree, editor, and terminal
- [ ] Unstaging a file moves it to Changes and navigation continues correctly
- [ ] Comments only on the right side; copy output is correct and sorted
- [ ] Syntax highlighting works in diffs for .ts, .py, .go, .rs

### Automated tests

Use `@vscode/test-electron` (included by `yo code`):

- Unit-test `Navigator.move()` with a fake `GitService` (looping, empty group, item removed).
- Unit-test `DiffOpener.uris()` for each status.
- Unit-test `ReviewExporter` formatting with fake threads.

---

## 9. Future improvements

- **Continuous review**: custom next-change that moves to the next file after the last change. Requires computing hunks yourself (e.g. the `diff` npm package on left/right document text), because the diff editor does not expose its line changes through the stable API.
- **Comments only on changed lines** (uses the same hunk computation).
- **Mark files as reviewed** (checkmark in the tree, skip reviewed files in navigation).
- **Persist comments** in `workspaceState` across restarts.
- **Per-hunk accept/reject** buttons via CodeLens in the diff.
- **Copy a single file's comments** or **copy with full diff** for more AI context.

---

## 10. References

- VS Code Extension API: https://code.visualstudio.com/api
- Tree View guide: https://code.visualstudio.com/api/extension-guides/tree-view
- Comments API sample: `microsoft/vscode-extension-samples` → `comment-sample`
- Git extension API types: `microsoft/vscode` → `extensions/git/src/api/git.d.ts`
- Git extension diff URI logic: `microsoft/vscode` → `extensions/git/src/repository.ts` (`getLeftResource`, `getRightResource`)
- Tabs API: `vscode.window.tabGroups`, `TabInputTextDiff`
- Packaging: https://code.visualstudio.com/api/working-with-extensions/publishing-extension

---

## 11. Working on this plan with an AI assistant

Suggested order of prompts:

1. "Scaffold M0 and M1 from this plan: package.json contributions, GitService, ReviewTree."
2. "Implement M2 DiffOpener and the empty content provider; follow section 5.3."
3. "Implement M3 Navigator with looping and context keys; follow section 5.4."
4. "Implement M4 staging actions."
5. "Implement M5 comments and M6 exporter; follow sections 5.6 and 5.7."
6. "Go through the edge cases in section 6 and add tests from section 8."

Give the assistant this file as context in each step, and review its changes with the extension itself once M3 works.

#!/usr/bin/env bash
# Creates a git repository with every kind of change the extension handles.
# "Run Extension" (F5) opens it in the Extension Development Host.
set -euo pipefail

REPO=/tmp/difftool-review-test
rm -rf "$REPO" && mkdir "$REPO" && cd "$REPO"
git init -q
git config user.name "Difftool Review Test"
git config user.email "difftool-review-test@example.com"

printf 'export const a = 1;\nexport const b = 2;\n' > modified.ts
printf 'def hello():\n    return "hi"\n' > deleted.py
printf 'old name\n' > old_name.txt
printf 'staged and unstaged\n' > both.js
# Nested folders for the tree view mode: `src/` holds a file and two folders,
# `docs/guide/` and `lib/helpers/` are single-child chains that get compacted.
mkdir -p src/util lib/helpers
printf 'export * from "./util/strings";\n' > src/index.ts
printf 'export const trim = (s: string) => s.trim();\n' > src/util/strings.ts
printf 'export const format = (n: number) => String(n);\n' > lib/helpers/format.ts
git add . && git commit -qm "initial"

printf 'export const a = 10;\nexport const b = 2;\nexport const c = 3;\n' > modified.ts
git rm -q deleted.py
git mv old_name.txt new_name.txt
printf 'brand new\n' > added.go && git add added.go
printf 'staged line\n' >> both.js && git add both.js
printf 'unstaged line\n' >> both.js
printf 'untracked\n' > untracked.rs
printf 'export * from "./tree/view";\n' >> src/index.ts && git add src/index.ts
printf 'export const upper = (s: string) => s.toUpperCase();\n' >> src/util/strings.ts && git add src/util/strings.ts
mkdir -p src/tree docs/guide
printf 'export const view = "tree";\n' > src/tree/view.ts && git add src/tree/view.ts
printf '# Guide\n' > docs/guide/intro.md && git add docs/guide/intro.md
printf 'export const pad = (n: number) => String(n).padStart(2, "0");\n' >> lib/helpers/format.ts
git add modified.ts
echo "Test repo ready at $REPO"

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
git add . && git commit -qm "initial"

printf 'export const a = 10;\nexport const b = 2;\nexport const c = 3;\n' > modified.ts
git rm -q deleted.py
git mv old_name.txt new_name.txt
printf 'brand new\n' > added.go && git add added.go
printf 'staged line\n' >> both.js && git add both.js
printf 'unstaged line\n' >> both.js
printf 'untracked\n' > untracked.rs
git add modified.ts
echo "Test repo ready at $REPO"

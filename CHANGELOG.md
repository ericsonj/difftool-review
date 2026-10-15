# Changelog

All notable changes to this extension are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Even minor versions are releases, odd minor versions are pre-releases.

## [0.1.0] - Pre-release

### Added

- Files panel with **Changes** and **Staged Changes** groups, opening each file in the built-in diff editor.
- File navigation that loops inside the current group (`Alt+N` / `Alt+P`), group switching (`Alt+G`) and change navigation inside the diff (`Alt+.` / `Alt+,`).
- Stage and unstage whole files or selected lines.
- Review comments on lines or selections, copied as one message for an AI chat.
- List or tree view of changed files (`difftoolReview.viewMode`).
- AI sessions: record the working tree before an assistant works and show only the files it changed.
- Command to let the shortcuts work while the integrated terminal has focus.

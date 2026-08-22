---
name: git-merge
description: Squash-merge a feature branch into master with a single Conventional Commits message.

disable-model-invocation: true
user-invocable: true
---

# Git Merge Workflow

Squash-merge a feature branch into `master` as a single Conventional Commits commit. The user may pass a branch name; if none is given, the currently checked-out branch is used.

## Hard rules

- The merge target is always `master`.
- Only the git commands listed in the steps below are allowed. `git push`, `git reset`, and `git clean` are explicitly forbidden, as is any other git command not listed here.
- If a check fails, stop immediately and report why. Do not continue to the merge.

## Input

- The user may pass a branch name (e.g. `bugfix_1`). If no branch name is given, use the currently checked-out branch.

## Preconditions

Run these checks in order; stop immediately on the first failure.

1. **Current branch.** `git branch --show-current`
2. **Not on `master`.** Verify that there are no uncommitted files. If there are uncommitted changes, stop immediately. Then switch to `master`: `git checkout master`
3. **Already on `master`.** If we were already on `master` and the user did not pass a branch name, stop immediately — there is nothing to merge.

## Preparation

Example — branch `bugfix_1`.

1. **Changed files.** `git diff master...bugfix_1 --stat`
2. **Commit list.** `git log master..bugfix_1 --oneline`

If the changes are not clear from the logs and the diff touches files under `docs/specs/`, read the spec for the task to understand what the branch does, for example:

`git show bugfix_1:docs/specs/model-ui-refresh/spec.md`
`git show bugfix_1:docs/specs/model-ui-refresh/draft.md`

## Commit message

You are an experienced senior developer.

Write exactly one message for the squash commit, based on the git diff and the commit history. The message must strictly follow Conventional Commits.

Critical rules:
- Write the description in lowercase (except abbreviations), concisely, with no period at the end of lines.
- Avoid bureaucratic language and overly ideal AI-like constructions (e.g. "Refactored the core mechanism to optimize efficiency"). Write like a human: "refactor core logic for authentication flow".
- If there are many changes, use the optional body after a blank line as short bullet points (`-`), at most 3–4 items.
- No emojis, no greetings, no AI mentions.

Format:

```
type(scope): description

[optional body]
```

## Merge

`git merge --squash bugfix_1`

`git commit -m "feat(auth): add jwt token rotation support"`

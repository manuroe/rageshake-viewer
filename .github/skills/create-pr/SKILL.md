---
name: create-pr
description: 'Create a pull request from current changes. Use when asked to commit changes, create a PR, open a pull request, submit changes, push to a branch, or make a PR. Produces separate conventional commits per logical concern.'
argument-hint: 'Brief description of the feature or fix (used for branch name and PR title)'
---

# Create PR

## When to Use
- User says "create a PR", "commit and push", "open a pull request", "submit these changes", "make a PR"
- After the user confirms the implementation direction — **never on the first iteration**

## Prerequisites

Pass the Pre-Commit Checklist before any commit:

```sh
npm run build   # must produce no errors
npm run lint    # must produce no warnings or errors
npm test -- --run --coverage  # coverage thresholds must pass
```

Do not proceed if any step fails. Fix the issue first.

## Procedure

### 1. Analyze the diff

Run `git diff --stat HEAD` and `git status` to understand all changed files.

Group changes into logical concerns — each concern becomes one commit. Examples:
- New utility function + its tests → one commit
- New component + its CSS module → one commit
- Type definition changes → bundle with the feature unless substantial
- Demo log extension → separate `chore(demo)` commit
- Documentation/AGENTS.MD changes → separate `docs` commit

### 2. Create a branch

```sh
git checkout -b <type>/<short-description>
```

Use the same type prefix as the primary commit. Lowercase, hyphen-separated.
Examples: `feat/search-filter`, `fix/parser-crash`, `chore/update-deps`

### 3. Commit each logical group

Write each commit message to `agent-workspace/commit-msg.txt`, then:

```sh
git add <files for this group>
git commit -F agent-workspace/commit-msg.txt
```

#### Conventional Commit Format

```
<type>(<scope>): <short description>

<optional body: what changed and why, not how>
```

**Types**

| Type | Use for |
|---|---|
| `feat` | New user-visible feature |
| `fix` | Bug fix |
| `refactor` | Code restructure without behavior change |
| `test` | Adding or updating tests only |
| `chore` | Build, tooling, config, demo log, deps |
| `docs` | Documentation only (AGENTS.MD, README, JSDoc) |
| `perf` | Performance improvement |
| `style` | CSS/visual changes with no logic change |

**Scopes** (optional but recommended):
`parser`, `store`, `views`, `components`, `extension`, `utils`, `types`, `deps`, `ci`, `demo`

**Rules**
- Subject line: imperative mood, lowercase, no trailing period, ≤72 chars
  - ✅ `feat(store): add time range filter`
  - ❌ `Added time range filter to store.`
- Body: explain *why*, not *what* — the diff shows what
- Breaking changes: add `!` after type/scope and a `BREAKING CHANGE:` footer

### 4. Write the PR description

Write to `agent-workspace/pr-body.md`:

```markdown
## Summary
<1-3 sentences describing what the PR does and why>

## Changes
- `<type>(scope): description` — what this commit does
- `<type>(scope): description` — what this commit does

## Testing
<Which commands to run and what to verify in the UI>
```

### 5. Push and create the PR

```sh
git push -u origin <branch-name>
gh pr create --title "<type>(<scope>): <description>" --body-file agent-workspace/pr-body.md
```

The PR title should match the primary commit's subject line.

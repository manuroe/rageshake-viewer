---
name: fix-review-comments
description: 'Address and fix GitHub PR review comments. Use when asked to review PR comments, fix reviewer feedback, address review threads, handle PR feedback, or batch-reply to reviewers.'
argument-hint: 'PR number (optional, defaults to current branch)'
---

# Fix Review Comments

## When to Use
- User says "review PR comments", "address feedback", "fix reviewer comments", "handle PR review"
- Responding to GitHub pull request review threads

## Procedure
1. Run `npm run pr:comments` to fetch unresolved actionable comments for the current branch, or `npm run pr:comments -- --pr <number>` to target a specific pull request.
2. Read `agent-workspace/pr-comments-for-agent.md` — contains structured comment list with IDs and reply endpoint types.
3. Create a to-do list and address each comment systematically (fix or explicitly reject).
4. Run the Pre-Commit Checklist before each commit (see AGENTS.MD): `npm run build && npm run lint && npm test -- --run --coverage`. Use conventional commit format for commit messages (type/scope reference: `.github/skills/create-pr/SKILL.md`).
5. Fill `agent-workspace/pr-replies-template.json` with one detailed reply per addressed comment.
6. Send all replies in one batch: `npm run pr:reply:batch`.

## Script Output Files (in `agent-workspace/`)
| File | Purpose |
|---|---|
| `pr-comments.json` | Raw structured PR data |
| `pr-comments-for-agent.md` | Formatted comments for agent consumption |
| `pr-replies-template.json` | Batch reply template to fill in |
| `pr-reply-results.json` | Results after sending replies |

## Reply Quality Guidelines
- Do **not** send only `Fixed in <sha>`.
- Preferred format: what changed, where it changed, and the commit reference/link.

## Rejecting a Comment
If a requested change contradicts user requirements or prior session discussions:
- Do **not** apply it.
- Set `"skip": true` for that item in `pr-replies-template.json`.
- Write a reply explaining clearly why the change was not applied and what the correct behavior is.
- Ask the reviewer to confirm or clarify before proceeding.
- No code change should accompany a rejection reply.

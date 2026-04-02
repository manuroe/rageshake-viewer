---
name: self-review
description: 'Pre-PR self-review checklist to catch recurring Copilot review comment patterns before pushing. Use when asked to self-review, run pre-PR review, or before creating a PR to reduce review back-and-forth. Walks through the diff against PATTERNS.md.'
argument-hint: 'Branch or commit range to review (optional, defaults to feature branch vs origin/main)'
---

# Self-Review

Run this skill before creating any PR. It walks the diff against the known Copilot
comment patterns in [PATTERNS.md](./PATTERNS.md) to catch issues before review.

## When to Use
- Before calling the `create-pr` skill (it's the Step 0 gate)
- When asked to "self-review", "run pre-PR review", or "check for review issues"

## Procedure

### 1. Get the diff

```sh
git diff $(git merge-base HEAD origin/main) HEAD -- ':!agent-workspace'
git diff --stat $(git merge-base HEAD origin/main) HEAD -- ':!agent-workspace'
```

Read the stat output to understand which file types changed.

### 2. For each changed TypeScript / TSX file — apply these patterns

**P1 — Comment/Implementation Mismatch**
- Every block comment above a condition or calculation describes what the code actually does.
- Every JSDoc `@param` / `@returns` / field description matches the current implementation.
- Test `it(...)` / `describe(...)` descriptions accurately reflect what is being asserted.
- After a rename, search for the old name in comments (`grep_search` the old identifier).

**P5 — Wrong Variable / Wrong Denominator**
- In any percentage/ratio calculation: is the denominator the concept it claims to measure?
- After adding a new data path (e.g. continuation lines in a parser), re-read every variable whose length or count the new data can change.

**P9 — Floating Promises / Missing Error Handling**
- Every `.then(...).catch(...)` chain is either returned, awaited, or prefixed with `void`.
- `navigator.clipboard`, fetch, and storage calls have `try/catch`.
- `navigate()` (react-router) is never `await`ed.
- `URL.revokeObjectURL` is deferred to `setTimeout(..., 0)`, not called synchronously after `a.click()`.

**P10 — ARIA Role / Keyboard Interaction Gaps**
- No element carries `role="menu"` / `role="menuitem"` without full arrow-key + Escape keyboard handling.
- New interactive list rows use `tabIndex={-1}` (roving tabindex), not `tabIndex={0}` on every item.
- Every symbol-only `<button>` has `aria-label`.

**P11 — Algorithm Complexity**
- No `.find()` / `.filter()` inside an outer loop over requests or log lines (pre-build a Map).
- No Map or index rebuilt on every call that could be computed once.
- Binary search used where available; linear scan only for small inputs.

**P12 — State Update / Close-Handler Edge Cases**
- Close callbacks use functional state updates (`prev => prev === thisItem ? null : prev`).
- No `onClose` unconditionally sets state to `null` that could clobber a concurrent open.

**P13 — Type Mutability**
- All new domain type properties (in `src/types/`) are `readonly`.
- Shared empty/default constants return fresh objects, not shared mutable references.
- Read-only parameters typed as `ReadonlyArray<T>` where applicable.

**P14 — Code Duplication**
- Before writing a new helper or regex, run `grep_search` for it.
- No new `formatBytes`, timestamp-strip regex, or log-line matcher that already exists in `src/utils/`.

**P15 — Regex Over- or Under-Matching**
- HTTP status code regexes use `\d{3}` (exactly 3), not `\d{3,}`.
- Timestamp-strip regexes accept the same variation as `extractISOTimestamp` in `logParser.ts` (with/without fractional seconds, with/without `Z`).
- Truthy checks (`if (x.field)`) not used where `0` or `''` are valid non-missing values.

### 3. For each changed CSS file — apply these patterns

**P2 — CSS Magic Numbers / Duplicated Computed Values**
- Any pixel value that is a sum of column widths or other layout values → define CSS custom properties, use `calc()`.
- Hard-coded colors → use CSS variable tokens from `foundation.css`.

**P3 — CSS Whitespace / Overflow Interaction Bugs**
- Elements in "wrap" mode use `white-space: pre-wrap`; "nowrap" variants override to `pre`.
- `overflow: hidden` does not silently clip content that should scroll in nowrap mode.

**P4 — CSS Accessibility / Pointer-Events**
- `pointer-events: none` on a container: verify no interactive child needs hover/click. If so, add `pointer-events: auto` on that child.
- `aria-label` on an element → element must have a matching `role` or be a native interactive element.
- Check color contrast for any new text-on-background combination, especially in the dark log viewer (`--text-secondary` on dark bg).

### 4. For each changed test file — apply these patterns

**P6 — Test Fixture Incompleteness**
- Log-line fixtures set `isoTimestamp`, `displayTime`, and `message` to values matching real parser output (full first physical line with timestamp+level prefix).
- Filter tests that say a request "should appear" actually include the filter keyword in the fixture's `rawText`.
- Test comments accurately describe the fixture structure (line counts, field values).

**P7 — Test Isolation / Mock Leakage**
- Any `beforeEach` that overwrites a global (`navigator.clipboard`, `URL.createObjectURL`, etc.) has a matching `afterEach` that restores the original (captured in a `let` before overwriting — `vi.restoreAllMocks()` does NOT restore property assignments).
- Fake timer tests flush pending timers before switching back to real timers.
- Zustand store state is reset between tests.
- Interactive element tests use `userEvent.hover` before `userEvent.click` when a trigger is only visible on hover.

### 5. For the PR description (`agent-workspace/pr-body.md`) — apply this pattern

**P8 — PR Description Staleness**
- Read `git diff --stat $(git merge-base HEAD origin/main) HEAD` and `agent-workspace/pr-body.md` side-by-side.
- Every changed file/feature must be mentioned in the PR description.
- Every paragraph in the PR description must map to a file or feature in the diff — delete any that don't.
- Update the "Testing" section to include the exact test run commands and the test count / coverage output shown after running them locally.

### 6. Declare result

After walking all changed files against all applicable patterns:

- **If no findings**: state "Self-review clean — no pattern matches found." and proceed to the `create-pr` skill.
- **If findings exist**: list each one (file + line + pattern ID + description). Fix all of them before proceeding. Re-run the relevant tests/lint as a spot-check after fixing.

## Reference
Full pattern descriptions and past examples: [PATTERNS.md](./PATTERNS.md)

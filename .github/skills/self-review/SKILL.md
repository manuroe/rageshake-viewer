---
name: self-review
description: 'Pre-PR self-review checklist to catch recurring Copilot review comment patterns before pushing. Use when asked to self-review, run pre-PR review, or before creating a PR to reduce review back-and-forth. Walks through the diff against PATTERNS.md.'
argument-hint: 'Reviews the current branch against origin/main using the merge base'
---

# Self-Review

Run this skill before creating any PR. It walks the diff against the known Copilot
comment patterns in [PATTERNS.md](./PATTERNS.md) to catch issues before review.

## When to Use
- As required by the `create-pr` skill's Step 0 gate
- When asked to "self-review", "run pre-PR review", or "check for review issues"

## Procedure

### 1. Get the diff

```sh
git diff $(git merge-base HEAD origin/main) HEAD -- . ':(exclude)agent-workspace' ':(exclude)*.png' ':(exclude)*.jpg' ':(exclude)*.jpeg' ':(exclude)*.gif' ':(exclude)*.webp' ':(exclude)*.svg' ':(exclude)*.ico'
git diff --stat $(git merge-base HEAD origin/main) HEAD -- . ':(exclude)agent-workspace' ':(exclude)*.png' ':(exclude)*.jpg' ':(exclude)*.jpeg' ':(exclude)*.gif' ':(exclude)*.webp' ':(exclude)*.svg' ':(exclude)*.ico'
```

Read the stat output to understand which file types changed.

### 2. For each changed TypeScript / TSX file — apply these patterns

**P1 — Comment/Implementation Mismatch**
- Every block comment above a condition or calculation describes what the code actually does.
- Every JSDoc `@param` / `@returns` / field description matches the current implementation.
- Test `it(...)` / `describe(...)` descriptions accurately reflect what is being asserted.
- After a rename, search for the old name in comments (for example, `git grep -n '<old_identifier>'`).
- JSDoc `@returns` precision: qualitative terms like "snapped to nearest" or column names like "URI column" match the actual implementation semantics.

**P5 — Wrong Variable / Wrong Denominator**
- In any percentage/ratio calculation: is the denominator the concept it claims to measure?
- After adding a new data path (e.g. continuation lines in a parser), re-read every variable whose length or count the new data can change.

**P8 — Floating Promises / Missing Error Handling**
- Every `.then(...).catch(...)` chain is either returned, awaited, or prefixed with `void`.
- `navigator.clipboard`, fetch, and storage calls have `try/catch`.
- `navigate()` (react-router) is never `await`ed.
- `URL.revokeObjectURL` is deferred to `setTimeout(..., 0)`, not called synchronously after `a.click()`.
- `localStorage.getItem` / `setItem` / `removeItem` in `useEffect` or startup paths are wrapped in `try/catch` (throws `SecurityError` in private-browsing mode).
- New file-processing paths apply the same validation gates (file-size limit, type guard) as existing paths.

**P9 — ARIA Role / Keyboard Interaction Gaps**
- No element carries `role="menu"` / `role="menuitem"` without full arrow-key + Escape keyboard handling.
- New interactive list rows use `tabIndex={-1}` (roving tabindex), not `tabIndex={0}` on every item.
- Every symbol-only `<button>` has `aria-label`.

**P10 — Algorithm Complexity**
- No `.find()` / `.filter()` inside an outer loop over requests or log lines (pre-build a Map).
- No Map or index rebuilt on every call that could be computed once.
- Binary search used where available; linear scan only for small inputs.
- `Math.max(...array)` / `Math.min(...array)` on large arrays → use `for` loop or `.reduce()`; large spreads can hit engine-specific maximum argument limits.
- New `Uint8Array` copies via `.buffer.slice()` → prefer `.subarray()` (zero-copy) or pass `Uint8Array` directly to `Blob`.

**P11 — State Update / Close-Handler Edge Cases**
- Close callbacks use functional state updates (`prev => prev === thisItem ? null : prev`).
- No `onClose` unconditionally sets state to `null` that could clobber a concurrent open.
- A `useEffect` that re-fetches on a reactive key change (e.g. `userId`) clears the prior result at effect start to prevent stale data showing during the new request.

**P12 — Type Mutability**
- All new domain type properties (in `src/types/`) are `readonly`.
- Shared empty/default constants return fresh objects, not shared mutable references.
- Read-only parameters typed as `ReadonlyArray<T>` where applicable.

**P13 — Code Duplication**
- Before writing a new helper or regex, search the codebase for an existing one (for example with `git grep` or `rg`).
- No new `formatBytes`, timestamp-strip regex, or log-line matcher that already exists in `src/utils/`.

**P14 — Regex Over- or Under-Matching**
- HTTP status code regexes use `\d{3}` (exactly 3), not `\d{3,}`.
- Timestamp-strip regexes accept the same variation as `extractISOTimestamp` in `logParser.ts` (with/without fractional seconds, with/without `Z`).
- Truthy checks (`if (x.field)`) not used where `0` or `''` are valid non-missing values.
- Format detection and format parser operate on the same string form (trimmed vs raw); detecting on trimmed but parsing raw causes all-UNKNOWN output.
- Regex character classes for enum-like token types enumerate all members (e.g. logcat priorities: `V D I W E F A` — not missing `A`).

**P17 — useCallback / useMemo Stale Dependency Array**
- Every `useCallback` and `useMemo` dep array includes all closed-over state, props, and store-selector results.
- Check for `// eslint-disable-next-line react-hooks/exhaustive-deps` suppressions that could be hiding a stale dep.
- For stable callbacks that intentionally omit deps, ensure the omitted value is read via `useRef` or `useLogStore.getState()` at call time.

**P18 — Keyboard Event `code` vs `key` for Character Shortcuts**
- `e.code === 'KeyX'` for character-intention shortcuts (wrap, print, save) → replace with `e.key.toLowerCase() === 'x'`.
- `e.code` is correct only for layout-independent physical keys (`'Escape'`, `'Enter'`, `'Space'`, arrow keys, etc.).

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
- Virtualizer mocks (`getVirtualItems`) include `end` (= `start + size`) matching the real TanStack virtualizer shape.
- When a utility gains a new side-effect call (e.g. `setLogFileName`), the happy-path test adds a matching assertion.
- Inline test literals typed as domain interfaces include all required fields; tsc excludes test files so gaps compile silently.

**P7 — Test Isolation / Mock Leakage**
- Any `beforeEach` that overwrites a global (`navigator.clipboard`, `URL.createObjectURL`, etc.) has a matching `afterEach` that restores the original (captured in a `let` before overwriting — `vi.restoreAllMocks()` does NOT restore property assignments).
- Fake timer tests flush pending timers before switching back to real timers.
- Zustand store state is reset between tests.
- Interactive element tests use `userEvent.hover` before `userEvent.click` when a trigger is only visible on hover.
- `HTMLElement.prototype` property restores in `afterEach` use `Object.getOwnPropertyDescriptor` + `Object.defineProperty`, not assignment to a fixed value.

**P16 — Test Spec Coherence**
- For UI tests that act as specification, the title describes a user-observable scenario. For integration tests, the title describes the public contract at that boundary.
- For hook tests, the title describes the hook interface contract or side-effect, not listener bookkeeping or branch-coverage intent.
- The fixture/setup actually creates the scenario the title claims (for example, matching URL params, filter text, or rendered labels).
- The assertions verify that same scenario rather than drifting into unrelated helper internals or store plumbing.
- A specific title needs a specific assertion: if the test says a formatted label, count, or state transition should appear, `expect(...).toBeInTheDocument()` on a generic container/button is not enough.
- Querying by role, label, or `data-testid` is fine when those are part of the contract; drilling into CSS classes or container structure just to prove existence is usually too indirect.
- Pure utility/algorithm tests may stay implementation-oriented, but their title, setup, and assertions still need to describe the same case.
- Branch-coverage language (`covers ...`, `idx=1`, line numbers) is a smell in behavior tests; prefer naming the actual scenario.
- P16 complements P1, P6, and P7: use it for title/setup/assertion drift, not wording-only mismatches, incomplete fixtures, or leaking mocks.

### 5. For each changed Markdown / docs / skill file — apply this pattern

**P15 — Documentation / Skill Internal Consistency**
- Sequential dependencies: if step N uses an artifact (e.g. `pr-body.md`, a built file), confirm that artifact exists at the point step N runs — not only in a later step.
- Command / tool names: every shell command referenced in prose must be real and executable. Verify with `which <cmd>` or `git grep` in the repo scripts if unsure.
- Repo-specific syntax: CSS selectors, naming conventions, or code patterns cited as examples must actually appear in the repo — use `git grep` to confirm.
- Cross-file claims: if doc A says "doc B describes X", read doc B and verify.
- Count / list consistency: if prose says "N patterns" or "N steps", count them.

### 6. Declare result

After walking all changed files against all applicable patterns:

- **If no findings**: state "Self-review clean — no pattern matches found." and proceed to the `create-pr` skill.
- **If findings exist**: list each one (file + line + pattern ID + description). Fix all of them before proceeding. Re-run the relevant tests/lint as a spot-check after fixing.

## Reference
Full pattern descriptions and past examples: [PATTERNS.md](./PATTERNS.md)

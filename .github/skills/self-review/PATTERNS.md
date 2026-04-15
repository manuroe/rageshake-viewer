# Self-Review Pattern Library

Recurring Copilot review comment categories observed across PRs #24–78 in this repo.
Consult this file during the self-review pass before creating any PR.

---

## P1 — Comment/Implementation Mismatch

**What it is**: A code comment, JSDoc, or type-level doc describes behavior that the implementation does not match.

**Where it appears**: Any `.ts` / `.tsx` / `.css` file with inline or block comments.

**What to look for**:
- Does every `// ...` comment above a condition/calculation describe what the code actually does?
- Does every JSDoc `@param`, `@returns`, or `@example` match the actual signature and behavior?
- Does every doc comment on a type/interface reflect the current field semantics (e.g. which timestamp field is used, sentinel values, default values)?
- Are unit-test descriptions accurate? (`it('clears uriFilter', ...)` but asserting on `logFilter`)
- Does the comment above a guard/regex describe the actual pattern?
- Does a CSS block comment (e.g. "No absolute positioning") remain accurate under all variant rules in the same file?
- Does a JSDoc `@returns` description match implementation semantics precisely — e.g. "snapped to nearest" vs ceiling, "URI column" vs "last visible column"?
- When a comment asserts a browser or language API's behavior, is the stated behavior accurate (e.g. `location.replace()` removes the entry from history; `Math.max(...array)` can throw at ~65k args)?

**Canonical fix**: Update the comment to match the code (preferred), or update the code to match the contract the comment describes — but never let them diverge.

**Past examples**:
- PR #57: "empty lines terminate a multi-line block" comment, but implementation just `continue`s without clearing `lastEntry`.
- PR #56: comment says "Mirrors timestamp logic for httpRequestsWithTimestamps" but code timestamps by `responseLineNumber`.
- PR #39: file-level comment says "Open in Visualizer link lives in last column", but it's in the File column.
- PR #38: comment says `stripPrefix` mirrors the view; state is initialized to `false` unconditionally.
- PR #38: doc says callers can rely on defaults for `ExportOptions`, but all fields are required.
- PR #37: test comment/section header still says `uriFilter` after rename to `logFilter`.
- PR #24: JSDoc says "Groups of 2+ lines collapsed", actual threshold is 4.
- PR #70: SyncView JSDoc says columns "collapse into the URI tooltip" — the URI column doesn't exist in focus mode; the actual target is the last visible column.
- PR #70: CSS comment "No absolute positioning" was incorrect; a variant rule in the same block adds `position: absolute`.
- PR #74: Tar parser docstring says "two consecutive zero blocks" but the implementation stops on the first zero block.
- PR #78: `computeAutoScale` JSDoc says "snapped to nearest" but uses a ceiling (smallest scale option ≥ raw value).

---

## P2 — CSS Magic Numbers / Duplicated Computed Values

**What it is**: A hard-coded pixel value in CSS that is derived from (or must stay in sync with) other values defined elsewhere — typically column widths, font sizes, or spacing tokens.

**Where it appears**: `.module.css` files; `foundation.css`.

**What to look for**:
- Is any pixel value a sum or derivative of other layout values (e.g. column widths)?
- Is the same value written in more than one place?
- Would a future column width change silently break this value's alignment?

**Canonical fix**: Define CSS custom properties (`--col-line-number`, `--col-timestamp`, etc.) in the parent scope and use `calc()` or `var()` wherever the derived value is needed.

**Past examples**:
- PR #57: `padding-left: 260px` on `.logLineContinuation` = 60px + 140px + 60px (column widths) — duplicated without variables.
- PR #24: `.collapseExact` / `.collapseSimilar` use hard-coded hex colors instead of CSS variables from `foundation.css`.

---

## P3 — CSS Whitespace / Overflow Interaction Bugs

**What it is**: A `white-space` or `overflow` property that conflicts with a parent or sibling rule, producing unintuitive truncation or wrapping behavior.

**Where it appears**: `.module.css` files for log/table views.

**What to look for**:
- Does the element have `white-space: pre` while a parent/ancestor uses `white-space: pre-wrap` for a "wrap" mode?
- Does `overflow: hidden` clip content that should scroll in "nowrap" mode?
- Is `white-space` mode-conditional? Does each mode variant explicitly set both `white-space` and `overflow`?

**Canonical fix**: Use `pre-wrap` in the base case and add a plain `.nowrap .thisClass` override that switches to `pre` + `overflow: auto` / `overflow: scroll`.

**Past examples**:
- PR #57: `white-space: pre` on `.logLineContinuation` prevented wrapping even when the parent row was in wrap mode; fixed by default to `pre-wrap` and `.nowrap` override.

---

## P4 — CSS Accessibility / Pointer-Events Pitfalls

**What it is**: Structural CSS mistakes that make interactive or labelled elements unreachable to users or assistive technology.

**Where it appears**: `.module.css` files; any component that mixes `pointer-events: none` with interactive children.

**What to look for**:
- Does a container set `pointer-events: none` while a child needs to receive hover/click (e.g. a tooltip pill)?  
  (`pointer-events` is **inherited** — children are also non-interactive unless they set `pointer-events: auto`.)
- Does an element have `aria-label` but no `role` and is not focusable? (The label won't be announced.)
- Does a non-interactive `<div>` carry `role="img"` or another role without making it keyboard-accessible?
- Is contrast of text-on-background acceptable? (Check `--text-secondary` on dark log backgrounds, small-font gap labels, etc.)

**Canonical fix**: Set `pointer-events: auto` on interactive children; add matching `role` and `tabIndex` or mark purely decorative elements with `aria-hidden`.

**Past examples**:
- PR #49: `.gapOverlay` has `pointer-events: none`, so `.gapLabel` pill also lost pointer events (inherited); `title` tooltip never appeared.
- PR #49: gap overlay has `aria-label` but no role, won't be announced.
- PR #55: row-action trigger used `var(--text-secondary)` in dark log background — low contrast.

---

## P5 — Wrong Variable / Wrong Denominator in Heuristics

**What it is**: A calculation uses an available variable that is close to but subtly wrong (e.g. total physical lines instead of logical entry count), causing the heuristic to break for edge-case inputs.

**Where it appears**: `src/utils/` — parser, stats, filter utilities.

**What to look for**:
- Is the denominator of a percentage/ratio the thing it's *supposed* to represent? (e.g. "percentage of timestamped lines" → denominator must be *logical entries*, not physical non-empty lines)
- Does a filter/guard variable change meaning when a new feature is added (e.g. multi-line entries inflate physical line count)?
- Could array lengths grow independently of the concept being measured?

**Canonical fix**: Name variables precisely; re-read the invariant after adding a new data path.

**Past examples**:
- PR #57: `totalNonEmptyLines` used as denominator for timestamp-percentage check; valid logs with long stack traces fell below the 10% threshold because multi-line continuation lines inflated physical line count.
- PR #52: `attemptTimestampsUs` filtered before mapping with `index`, shifting attempt outcomes out of alignment.

---

## P6 — Test Fixture Incompleteness

**What it is**: Test fixtures omit fields that the real system populates, so the test can pass while hiding regressions in the omitted fields.

**Where it appears**: `src/views/__tests__/`, `src/utils/__tests__/`, `src/components/__tests__/`.

**What to look for**:
- Does a fixture leave type fields at their default (e.g. `isoTimestamp: ''`, `displayTime: ''`) when the production code path sets them non-trivially?
- Does `message` in a log-line fixture match the full raw first physical line (timestamp + level + text), as the real parser outputs?
- Does a test comment/description numerically conflict with the fixture (e.g. "2 collapsed lines" when 3 are created)?
- Does a filter test assert "this request should appear" when the fixture text doesn't actually contain the filter keyword?
- When the component calls a new utility method as a side-effect (e.g. `setLogFileName`), does the happy-path test include an assertion for that call?
- Are virtualizer mocks (e.g. `getVirtualItems`) missing the `end` field (`= start + size`)? The real TanStack virtualizer always includes it.
- Are inline test literals typed as domain interfaces missing required fields? TypeScript excludes test files from strict checking by default, so these gaps compile silently.

**Canonical fix**: Set all semantically meaningful fields to values that mirror what the real parser or component produces; cross-check comments against fixture structure.

**Past examples**:
- PR #57: fixtures omitted `isoTimestamp`/`displayTime` and used a partial `message` — hid regressions around `stripPrefix`/timestamp rendering.
- PR #37: sentinel-guard test comments said "should appear" but the fixture `rawText` didn't contain the keyword.
- PR #24: comment says "2 collapsed lines" but `createDuplicateLogLines()` creates 3.
- PR #68: `getVirtualItems` mock missing `end: start + size` in three test files — virtualizer consumers using `end` silently received `undefined`.
- PR #76: `useExtensionFile` happy-path test did not assert that `setLogFileName` was called after the store gained that side-effect.
- PR #65: inline fixtures typed as request interfaces were missing the required `uri` field; tsc excluded test files so the gap compiled silently.

---

## P7 — Test Isolation / Mock Leakage

**What it is**: Global APIs or store state modified in one test leaks into others because mocks/patches are not cleaned up.

**Where it appears**: `src/**/__tests__/` files that mock `navigator.clipboard`, `URL.createObjectURL`, `URL.revokeObjectURL`, timer APIs, or Zustand store state.

**What to look for**:
- Does `beforeEach` overwrite a global (e.g. `navigator.clipboard`, `URL.createObjectURL`)? If so, is there a matching `afterEach` that restores or deletes it?
- Note: `vi.restoreAllMocks()` **does not** restore manually assigned properties — you must capture and restore originals explicitly.
- Are fake timers switched on/off? Are pending timers flushed before switching back to real timers?
- Is the log store (or any Zustand store) reset to a known state between tests?
- Is a `fireEvent.click` targeting an element that is `pointer-events: none` until hover (masking a real interaction regression)?
- When restoring an `HTMLElement.prototype` property in `afterEach`, is the original descriptor captured with `Object.getOwnPropertyDescriptor` and restored with `Object.defineProperty`? Assigning a fixed value (e.g. `0`) is not a true restore and can leak into subsequent tests.

**Canonical fix**: Capture globals in a `let original` variable before each test; restore in `afterEach`. Use `vi.useRealTimers()` + flush pending timers before cleanup.

**Past examples**:
- PR #38: `navigator.clipboard` overwritten in `beforeEach` with no `afterEach` restore; `vi.restoreAllMocks()` doesn't restore property values.
- PR #38: fake timers switched back to real without flushing pending timers first.
- PR #55: test clicked a trigger that is `pointer-events: none` until row hover, so the real hover→click interaction path was never exercised.
- PR #78: `afterEach` set `HTMLElement.prototype.clientWidth` back to `0` instead of restoring the original property descriptor — subsequent tests that relied on the real getter would see `0`.

---

## P8 — Floating Promises / Missing Error Handling

**What it is**: An async call whose result is not returned, awaited, or prefixed with `void`, creating an unhandled rejection. Also: `await` without `try/catch` on operations that can fail in the browser (clipboard, network, storage).

**Where it appears**: Event handlers, `useEffect` bodies, message listeners.

**What to look for**:
- Is a `.then(...).catch(...)` chain assigned to nothing and not prefixed with `void`? (`@typescript-eslint/no-floating-promises` flags this.)
- Does `await navigator.clipboard.writeText(...)` have a `try/catch`? Clipboard access can be denied.
- Does `await navigate(...)` appear? `navigate()` returns `void`, not a Promise — awaiting it trips `@typescript-eslint/await-thenable`.
- Does a `download` flow `URL.revokeObjectURL(url)` synchronously after `a.click()`? (Some browsers need the URL to remain alive until after the download starts; revoke in a `setTimeout` instead.)
- Are `localStorage.getItem` / `setItem` / `removeItem` calls in a `useEffect` or startup path wrapped in `try/catch`? They can throw a `DOMException` (for example `SecurityError` or `QuotaExceededError`) when storage access is blocked or quota is unavailable.
- When adding a new file-processing path (e.g. `.tar.gz`), do all validation gates from existing paths (file-size limit, MIME type check) apply to the new path too?

**Canonical fix**: Prefix floating promise chains with `void`; wrap fallible browser APIs in `try/catch` with user-visible error feedback; use `setTimeout(() => URL.revokeObjectURL(url), 0)`.

**Past examples**:
- PR #39: `.then(...).catch(...)` chains in background worker message handler were floating Promises.
- PR #38: `navigator.clipboard.writeText(...)` awaited without `try/catch`.
- PR #38: `URL.revokeObjectURL(...)` called synchronously after `a.click()`.
- PR #71: `loadAndClearTabLog` called `localStorage.getItem` / `removeItem` without `try/catch`; `storeTabLog` called `crypto.randomUUID()` without `try/catch` — both can throw in restricted environments.
- PR #74: `.tar.gz` upload path bypassed the file-size validation gate that `.gz` files go through.

---

## P9 — ARIA Role / Keyboard Interaction Gaps

**What it is**: A component declares a complex ARIA role (`menu`, `menuitem`, `listbox`, etc.) without implementing the keyboard interaction pattern that the role implies.

**Where it appears**: Interactive components in `src/components/`.

**What to look for**:
- Does any element carry `role="menu"` or `role="menuitem"`?  
  If so: are arrow keys, Home/End, and Escape fully handled? Is focus managed correctly?
- Is `tabIndex={0}` applied to every row in a large virtualized list? (Creates hundreds of tab stops — use roving tabindex instead.)
- Does a symbol-only button have `aria-label`?

**Canonical fix**: Use plain `<button>` semantics and omit `role="menu"` unless you implement the full ARIA menu keyboard pattern. Use `tabIndex={-1}` with a roving tabindex approach for large lists.

**Past examples**:
- PR #55: `RowTimeAction` declared `role="menu"` / `role="menuitem"` without arrow-key navigation or Escape handling.
- PR #55: trigger `tabIndex={0}` on every row — created hundreds of tab stops in the request table.

---

## P10 — Algorithm Complexity Regressions

**What it is**: A new or changed function performs O(n²) or worse work in a hot path (virtualized list rendering, per-request processing, per-line parsing).

**Where it appears**: `src/utils/` (parser, stats, filters), `src/components/` (chart computations).

**What to look for**:
- Is a `.find()`, `.filter()`, or nested `.forEach()` executed inside an outer loop over requests or log lines?
- Is a Map or index rebuilt on every call instead of being computed once and cached?
- Is a binary search available but a linear scan used instead?
- Does a `useMemo` dependency correctly gate an expensive computation, or does it recompute more often than needed?
- Does `Math.max(...array)` or `Math.min(...array)` spread an array that could exceed ~65k elements? At that size the spread can exceed the JavaScript engine's argument limit for a single call and throw — use a `for` loop or `.reduce()` instead.
- Does new code copy a `Uint8Array` via `.buffer.slice()` when a zero-copy `.subarray()` view would suffice? `Blob` constructors accept `Uint8Array` directly without an intermediate copy.

**Canonical fix**: Hoist invariants outside loops; use pre-built Maps/indices; replace linear scans with binary search; use `useMemo` with tight dependency arrays.

**Past examples**:
- PR #56: `stackedLayers` recomputed cumulative `y0` by iterating all lower layers per timestamp — O(keys² × times).
- PR #27: two `rawLogLines.find(...)` scans per request during parsing — O(n×m).
- PR #37: `query` and `getLine` recomputed inside per-request filter callback.
- PR #62, #63: `Math.max(...timestamps)` / `Math.max(...uploadLayers.flatMap(...), 1)` spread on arrays that could exceed argument limits at scale.
- PR #74: `entry.data.buffer.slice()` created an unnecessary copy of tar entry data; passing `entry.data` directly to `Blob` is zero-copy.

---

## P11 — State Update / Close-Handler Edge Cases

**What it is**: A state setter in a close/open callback clobbers state set by a concurrent interaction (e.g. opening a new row's menu clears the z-index elevation of the previously active row).

**Where it appears**: `src/components/` and `src/views/` — any component that tracks "which row/item is active".

**What to look for**:
- Does an `onClose` callback unconditionally set state to `null`/`false`, even when a *different* item is now active?
- Should the setter use a functional update (`prev => prev === thisItem ? null : prev`) to avoid clobbering a concurrent open?
- When a `useEffect` re-fetches data keyed on a reactive value (e.g. `userId`), is the prior result cleared at effect start to prevent stale data from showing during the new request?

**Canonical fix**: Use functional state updates that compare the closing item's identity to the current state before resetting.

**Past examples**:
- PR #55: `RowTimeAction.onOpenChange` set `menuOpenForIndex` to `null` whenever *any* row closed, even if a different row had just opened.
- PR #55: same pattern in `RequestTable` with `menuOpenForRowKey`.
- PR #74: `matrixProfile` state was not cleared when `userId` changed — the previous user's avatar/name remained visible until the new fetch completed.

---

## P12 — Type Mutability Contract Violations

**What it is**: A function returns or exposes a mutable type for data that is logically immutable; or a shared "empty" constant has mutable fields that could be accidentally mutated by callers.

**Where it appears**: `src/types/`, `src/utils/` (especially stats and parser output types).

**What to look for**:
- Are all domain type properties `readonly`? (Repo rule: all properties in `src/types/` must be `readonly`.)
- Does a shared singleton constant (like `EMPTY_STATS`) expose mutable arrays? (Return a fresh copy instead.)
- Is a function parameter typed as `Array<T>` when it never mutates the input? (Prefer `ReadonlyArray<T>`.)
- Is there a `as MutableType[]` cast that unnecessarily widens away a readonly contract?

**Canonical fix**: Add `readonly` to all domain type fields; return fresh objects from empty/default factories; use `ReadonlyArray` for read-only parameters.

**Past examples**:
- PR #30: `EMPTY_STATS` shared singleton had mutable arrays — callers could mutate shared state.
- PR #30: `snapSelectionToLogLine` accepted mutable `Array` but never mutated it; should be `ReadonlyArray`.

---

## P13 — Code Duplication

**What it is**: The same logic, regex, or helper is defined in two places rather than being extracted into a shared utility.

**Where it appears**: Anywhere — most commonly when adapting logic from a React component into a util, or when adding a similar helper in a different module.

**What to look for**:
- Before writing a new regex or helper function, search the codebase for an existing one that does the same thing (for example with `git grep` or `rg`).
- Does the new code duplicate a pattern already in `src/utils/sizeUtils.ts`, `src/utils/logMessageUtils.ts`, or `src/utils/textMatching.ts`?

**Canonical fix**: Extract the shared implementation to `src/utils/`, import it from both call sites.

**Past examples**:
- PR #38: `STRIP_PREFIX_RE` duplicated the identical regex from `LogDisplayView.getDisplayText()`.
- PR #39: `formatBytes` in content script duplicated (and diverged from) `src/utils/sizeUtils.ts`.

---

## P14 — Regex Over- or Under-Matching

**What it is**: A regex matches too broadly (accepting invalid input) or too narrowly (rejecting valid input), usually due to quantifier choice or missing anchors.

**Where it appears**: `src/views/LogDisplayView.tsx`, `src/utils/logMessageUtils.ts`, `src/utils/logParser.ts`, CSS-module selectors.

**What to look for**:
- `\d{3,}` where exactly `\d{3}` is intended (HTTP status codes are always 3 digits).
- A `LOG_PREFIX_RE` or `STRIP_PREFIX_RE` that requires fractional seconds or a trailing `Z`, when the parser accepts timestamps without those components.
- A `truthy` check (`if (x.fieldName)`) used instead of `!== undefined` / `!= null` when `0` or `''` are valid values.
- Format detection and format parser must operate on the same string form (trimmed vs raw). Detecting on a trimmed line but parsing the raw line causes files to be detected as the new format yet parsed as all-UNKNOWN entries.
- Regex character classes for enum-like tokens must enumerate all members. For example, the standard logcat priority levels are `V D I W E F A` — omitting `A` (ASSERT) silently parses those lines as UNKNOWN.

**Canonical fix**: Use exact quantifiers (`{3}`); test the regex against the full set of values the parser accepts, not just the canonical form.

**Past examples**:
- PR #25: `HTTP_ERROR_RE` used `\d{3,}` — matched `status=4040` as a valid 400x status code.
- PR #38: `LOG_PREFIX_RE` required `Z` and fractional seconds, missing valid timestamps the parser normalizes.
- PR #24: `getLineRelation` used truthy check on `sourceLineNumber`, treating `0` as "missing".
- PR #75: `isLogcatFormat` detected on `trimmed` but `parseLogcatContent` parsed raw `line` — logcat files were detected correctly but every line parsed as UNKNOWN.
- PR #75: `LOGCAT_LINE_RE` omitted the `A` (ASSERT) priority level, causing assert-level log lines to parse as UNKNOWN.

---

## P15 — Documentation / Skill Internal Consistency

**What it is**: Prose documentation (skills, AGENTS.MD, READMEs) that contradicts itself or references things that don't exist in the repo — wrong step ordering, phantom tool names, syntax that the repo doesn't use, or a prerequisite assumed present before it is created.

**Where it appears**: `.github/skills/**/*.md`, `AGENTS.MD`, `docs/`, any Markdown file changed in the PR.

**What to look for**:
- Sequential dependencies: if step N uses an artifact (e.g. `pr-body.md`, a built file, a config), confirm that artifact exists at the point step N runs — not only in a later step.
- Command / tool names: every shell command (for example, `grep` or `npx foo`) referenced in prose must be a real, executable command; avoid Copilot tool names like `grep_search` in shell-command examples. Verify with `which <cmd>` or `git grep <cmd>` in the repo scripts if unsure.
- Repo-specific syntax: CSS selectors, naming conventions, or code patterns cited as examples must actually appear in the codebase. Use `git grep` to confirm before writing them into docs.
- Cross-file claims: if doc A says "doc B describes X", read doc B and verify it actually does.
- Count / list consistency: if prose says "N patterns" or "N steps", count them.

**Canonical fix**: Fix the ordering, remove the phantom reference, or replace the example with one `git grep` confirms exists in the repo.

**Past examples**:
- PR #58: `create-pr/SKILL.md` Step 0 said "before any commit" but `pr-body.md` (referenced in the same step) is only written in Step 4 — ordering contradiction.
- PR #58: `PATTERNS.md` and `SKILL.md` both referenced `grep_search` as a shell command; it is a Copilot tool, not an executable — phantom name.
- PR #58: `PATTERNS.md` P3 canonical fix cited `.nowrap &` (CSS nesting); the repo's `.module.css` files use plain selectors only — verified false by `git grep`.

---

## P16 — Test Spec Coherence

**What it is**: A test that is meant to specify observable behavior drifts out of alignment: the title describes one scenario, the fixture/setup creates another, or the assertions verify something else.

**Where it appears**: UI, integration, and hook tests in `src/**/__tests__/`, plus any lower-level test where the scenario name, setup, and assertions can silently drift apart.

**What to look for**:
- For UI tests, does the `it(...)` / `describe(...)` text describe a user-observable behavior? For integration tests, does it describe the public contract of the boundary under test (for example URL params synchronizing into app state)?
- For hook tests, does the title describe the hook's interface contract or side-effect (`calls onClose`, `syncs scroll`, `returns debounced value`) rather than listener bookkeeping, branch coverage, or line coverage?
- Does the fixture/setup actually contain the condition the title claims (for example, the URL params, filter text, or rendered label needed for the scenario)?
- Do the assertions verify that same scenario, instead of only checking unrelated helper internals or store plumbing?
- If the title promises a specific displayed outcome or state transition, do the assertions verify that outcome directly rather than only proving the component rendered or a generic button exists?
- Are the selectors and assertions operating at the same abstraction level as the title? Querying by role, label, or `data-testid` is fine when those are part of the contract; drilling into CSS classes or container structure just to prove something exists is usually too indirect.
- If the test is intentionally low-level (parser, regex, byte detection, pure filter logic), is it still internally coherent even if it does not use user-facing language?
- Does the title drift into implementation-tracking language such as `covers branch`, `idx=1`, line numbers, or `attaches listener` when the real scenario could be named directly?
- Does this finding belong here rather than in P1, P6, or P7? Use P16 when the problem is scenario drift between title, setup, and assertion; use the others for wording accuracy, missing fixture fields, or mock leakage.

**Canonical fix**: Rewrite the test so the title, fixture/setup, and assertions all describe the same scenario. For UI coverage, prefer framing the scenario in terms of what the user can observe. For integration coverage, assert the public contract at that boundary directly. For hook tests, name the interface contract or side-effect. For lower-level tests, keep the algorithmic framing but make the setup and assertion match it exactly.

**Past examples**:
- Current suite: `TimeRangeSelector.test.tsx` uses visible labels and menu state (`"All time"`, expanded dropdown) to describe and verify what the user sees.
- Current suite: `AppParameterSync.test.tsx` treats the URL as part of the public contract by asserting that `filter`, `status`, and time params restore the expected app state together.
- Current suite: `useScrollSync.test.ts` is a good hook example because the title names the side-effect and the assertion verifies the exact synced `scrollTop` value.
- Current suite: `ErrorDisplay.test.tsx` includes a warning block title with branch/line-coverage language; that is the kind of title P16 should push back toward the actual rendered warning behavior.
- Current suite: `LogsView.test.tsx` verifies that changing the time range changes the rendered shown/total counts, which is the behavior the user experiences.
- Boundary example: `fileValidator.test.ts` is intentionally low-level; it does not need UI language, but the title, byte fixture, and assertions still need to describe the same validation case.

---

## P17 — useCallback / useMemo Stale Dependency Array

**What it is**: A `useCallback` or `useMemo` closes over a state, prop, or store-selector result that is omitted from the dependency array, producing a stale closure that silently uses an outdated value.

**Where it appears**: Any component that passes callbacks to child components or event handlers while also reading from Zustand store state, React props, or local `useState`.

**What to look for**:
- Does the callback body read a variable (state, prop, store selector result) that is not listed in its `[]` dependency array?
- Stale pattern: `const handleX = useCallback(() => { doSomething(valueFromState); }, [])` — `valueFromState` is closed over but not in deps.
- Does a `useMemo` computation use a variable and omit it from its deps?
- Check for `// eslint-disable-next-line react-hooks/exhaustive-deps` suppressions that may be hiding this.

**Canonical fix**: Add the omitted variable to the dependency array. For stable callbacks that must not re-create on every render, read the value through a `useRef` kept in sync, or call `useStore.getState()` at invocation time instead of closing over a selector result.

**Past examples**:
- PR #76: `handleOpenInNewTab` closed over `logFileName` from `useLogStore` but `logFileName` was omitted from the `useCallback` dep array — the callback always used the initial (empty) filename.

---

## P18 — Keyboard Event `code` vs `key` for Character Shortcuts

**What it is**: Using `KeyboardEvent.code` (physical key position on a QWERTY layout) instead of `KeyboardEvent.key` (logical character) for character-based keyboard shortcuts. This breaks the shortcut on AZERTY, DVORAK, and other non-QWERTY keyboard layouts.

**Where it appears**: `keydown` / `keyup` listeners in `useEffect` hooks and event handlers in `src/views/` and `src/components/`.

**What to look for**:
- Any `e.code === 'KeyX'` check where `X` is a character the user types for its intent (e.g. `'KeyW'` for wrap, `'KeyP'` for print, `'KeyS'` for save).
- `e.code` is correct for layout-independent physical or modifier keys: `'Space'`, `'Enter'`, `'Escape'`, `'Tab'`, `'ArrowUp'`, etc.
- `e.code` is **wrong** for character-intention shortcuts — use `e.key.toLowerCase()` instead.

**Canonical fix**: Replace `e.code === 'KeyX'` with `e.key.toLowerCase() === 'x'` for character-intention shortcuts. Keep `e.code` only for physical / positional keys where layout-independence is desired.

**Past examples**:
- PR #73: `e.code === 'KeyW'` / `e.code === 'KeyP'` used for wrap-toggle and print shortcuts in `LogDisplayView` — broke on AZERTY/DVORAK layouts.

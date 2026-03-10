# Agent Context: Matrix Rust SDK Log Visualiser

## Project Overview
A web application for visualizing and analyzing Matrix Rust SDK logs.

## Audience & Scope
This document is a lightweight guide for contributors and automated agents. It focuses on stable concepts and boundaries, not implementation details.

## Tech Stack (High-Level)
- Vite + React + TypeScript
- React Router (hash-based)
- Zustand state management
- CSS Modules with Design Tokens ([src/styles/foundation.css](src/styles/foundation.css))
- Virtualized rendering for large datasets
- ESLint enforcing camelCase naming

## Repository Layout (Intent-Oriented)
- Entry + routing: [src/main.tsx](src/main.tsx), [src/App.tsx](src/App.tsx)
- Views: [src/views](src/views)
- Components: [src/components](src/components)
- Styles: [src/styles](src/styles) (foundation tokens), shared modules in [src/components](src/components) (Button, Card, Table, Form, Dropdown)
- State: [src/stores](src/stores)
- Domain utilities: [src/utils](src/utils)
- Types: [src/types](src/types)
- Tests: [src/__tests__](src/__tests__), [src/components/__tests__](src/components/__tests__), [src/views/__tests__](src/views/__tests__), [src/utils/__tests__](src/utils/__tests__)

## Core Principles
- Precompute expensive parsing once; filtering should be cheap.
- Keep domain logic in stores/utils, UI-specific logic in views/components.
- Prefer predictable, immutable updates for state (e.g., replace sets/arrays to trigger updates).
- Shareable URLs: global time filters should sync to query parameters.
- Efficiency first: fast loading, instant search, dark mode, sensible defaults.
- After parsing, most UI and filtering logic is log-agnostic; Matrix-specific behavior is mainly in some views.

## Useful Commands
- Start dev server: `npm start`
- Build: `npm run build`
- Preview build: `npm run preview`
- Lint: `npm run lint`
- Unit tests: `npm test -- --run` (exits after completion; omit `-- --run` for watch mode)
- Performance benchmarks: `npm run bench`
  - Runs `.perf.test.ts` suites in Node runtime and reports results through CodSpeed in CI
- Fetch PR review comments (unresolved actionable list): `npm run pr:comments` (auto-detects current branch) or `npm run pr:comments -- --pr <number>`
- Batch-reply to PR comments from template file: `npm run pr:reply:batch` (reads `pr-replies-template.json`)
- Reply to a single PR review comment: `npm run pr:reply -- --comment-id <id> --message "<text>"`

## When to Commit

Do **not** commit on the first iteration. Write the code, show the user what changed, and wait for feedback. Only commit once the user confirms the direction is correct — or explicitly asks you to commit.

## Pre-Commit Checklist (for Agents)

Before committing **any** code change (new feature, bug fix, PR comment fix, refactor, etc.), always run the following commands and resolve all errors before proceeding:

```sh
npm run build   # must produce no errors
npm run lint    # must produce no warnings or errors
npm test -- --run --coverage  # coverage thresholds must pass
```

Do not commit if any of these steps fail. Fix the issue first, then re-run the full checklist before committing.

**Manual review** — before committing, scan the diff against each pillar in [Code Quality Standards](#code-quality-standards) and verify all apply.

## PR Review Workflow (for Agents)

When prompted **"Review PR comments"**:
1. Run `npm run pr:comments`.
2. Read `pr-comments-for-agent.md` for unresolved actionable comments (contains comment IDs and reply endpoint type).
3. Create a todo list and address each comment systematically (fix or reject).
4. Run the [Pre-Commit Checklist](#pre-commit-checklist-for-agents) before each commit.
5. Fill `pr-replies-template.json` with one detailed reply per addressed comment.
6. Send replies in one batch with `npm run pr:reply:batch` (or `npm run pr:reply -- --batch-file <path>`).

Reply quality guideline:
- Do not send only `Fixed in <sha>`.
- Prefer a concise detailed format: what changed, where it changed, and the commit reference/link.

Rejecting a comment:
- If a requested change contradicts the user's requirements or prior discussions in the session or makes no sense, **do not apply it**.
- Set `"skip": true` for that item in `pr-replies-template.json`.
- Write a reply explaining clearly why the change was not applied and what the correct behavior is.
- Ask the reviewer to confirm or clarify before proceeding.
- No code change should accompany a rejection reply.

## Architecture
1. Parse log text into structured records once.
2. Store parsed results and filters centrally in Zustand. Global filters (time range) are shared across views; each view applies its own view-specific filters on top.
3. Views render filtered results; large lists are virtualized.
4. UI state (expanded rows, open log viewers) is kept in the store for consistent behavior across views.

## Code Quality Standards

Every change must uphold these pillars — apply them when writing, not just at review time.

**Clean**: `eslint-disable` requires an inline justification. Warnings are errors in this repo.

**Well Documented**: Every exported symbol gets a JSDoc explaining *why* it exists, not just what it does. Non-obvious decisions need an inline comment. Utils in `src/utils/` need at least one `@example`.

**Composable**: Domain logic in `src/utils/` or `src/stores/` only — never inside component render or handlers. Components never call `useStore.setState()` directly; always use a named store action.

**Easy to Test**: Every new pure function (`src/utils/__tests__/`) and hook (`src/hooks/__tests__/`) gets a unit test asserting on concrete output. Mock only external boundaries (network, store, router).

**No Duplication**: Search before writing. If the same block appears in two or more places, extract it immediately (utility function, shared hook, or store action).

**AI-Generated Code — extra watch-outs**: all domain type properties must be `readonly`; all literals need named constants; every `setTimeout`/`addEventListener` in a `useEffect` needs a cleanup return; symbol-only buttons need `aria-label`.

## Performance Regression Detection
CI runs benchmark suites via CodSpeed and publishes performance tracking/results on codspeed.io and GitHub checks.

**Local Development**: Run `npm run bench` to execute the same benchmark suites locally (timing output only).

## Demo Log File

A hand-crafted demo log lives at [`public/demo/demo.log`](public/demo/demo.log). It is served as a static asset and loaded by the **"Try with demo logs"** link on the landing page, letting users explore the app without a real log file.

**When adding a new feature**, extend `public/demo/demo.log` so the feature is visible and exercisable in the demo. The log must remain a valid, parseable Matrix Rust SDK log that exercises all existing app capabilities as well as the new one.

## Demo Screenshots

Screenshots in [`public/demo/screenshot-*.png`](public/demo/) are **generated and committed automatically by CI** ([.github/workflows/screenshots.yml](.github/workflows/screenshots.yml)) using a headless Chromium on Ubuntu, then compressed with pngquant for a consistent, OS-independent result.

**Do not regenerate screenshots locally.** Push your changes and let CI update them. If you need to verify what the screenshots will look like, run the dev server and inspect the UI manually.

## Contribution Guidelines
- Use camelCase for identifiers (lint enforced).
- Prefer additive changes over refactors unless necessary.
- Every new feature must be represented in [`public/demo/demo.log`](public/demo/demo.log).
- Always pass the [Pre-Commit Checklist](#pre-commit-checklist-for-agents) (`npm run build`, `npm run lint`, `npm test -- --run --coverage`) before committing.

## Reference Files (Entry Points)
- Routing: [docs/APP_ROUTING.md](docs/APP_ROUTING.md)
- Store: [src/stores/logStore.ts](src/stores/logStore.ts)
- URL params: [src/hooks/useURLParams.ts](src/hooks/useURLParams.ts)
- Parser: [src/utils/logParser.ts](src/utils/logParser.ts)
- Time utilities: [src/utils/timeUtils.ts](src/utils/timeUtils.ts)
- Log views: [src/views](src/views)
- Demo log: [public/demo/demo.log](public/demo/demo.log)


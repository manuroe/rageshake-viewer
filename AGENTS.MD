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
- Default to fast, readable UI for debugging large logs.
- After parsing, most UI and filtering logic is log-agnostic; Matrix-specific behavior is mainly in the some views.

## UX/UI Design
**Target Audience**: Developers debugging Matrix Rust SDK issues

**Core Principles**:
- Efficiency first: fast loading, instant search, minimal clicks.
- Shareable URLs for filters and views.
- Dark mode and copy-friendly UI for long sessions.
- Sensible defaults that reduce setup time.

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

## Pre-Commit Checklist (for Agents)

Before committing **any** code change (new feature, bug fix, PR comment fix, refactor, etc.), always run the following commands and resolve all errors before proceeding:

```sh
npm run build   # must produce no errors
npm run lint    # must produce no warnings or errors
npm test -- --run --coverage  # coverage thresholds must pass
```

Do not commit if any of these steps fail. Fix the issue first, then re-run the full checklist before committing.

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

## Architecture (Conceptual)
1. Parse log text into structured records once.
2. Store parsed results and filters centrally in Zustand.
3. Views render filtered results; view-specific filters do not affect other views.
4. Large lists are virtualized to avoid rendering all rows.

## State Management (Conceptual)
- Global filters (e.g., time range) are shared across views.
- Each view applies its own view-specific filters on top of global ones.
- UI state (expanded rows, open log viewers) is kept in the store for consistent behavior.

## Minimal Examples (Non-Exhaustive)
- When adding a new view: keep data access in the store and render-only logic in the view.
- When adding a filter: update store filter logic, then read the filtered list in the view.
- When dealing with large lists: use virtualized rendering.

## Anti-Patterns to Avoid
- Computing expensive parsing in render.
- Re-filtering large collections on every render.
- Mixing domain parsing logic inside UI components.
- Storing cross-view filters in local component state.

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
- Avoid embedding parsing logic directly in components.
- Prefer additive changes over refactors unless necessary.
- Keep documentation high-level; link to code for implementation specifics.
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

